import { fileURLToPath } from "node:url";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CollaborationDraftService } from "../../src/application/collaborations/collaboration-draft-service.js";
import { CollaborationPublicationService } from "../../src/application/collaborations/collaboration-publication-service.js";
import { DeliveryRunner } from "../../src/application/outbox/delivery-runner.js";
import type { ClaimTokenGenerator } from "../../src/application/ports/claim-token.js";
import type { ProviderDeadline } from "../../src/application/ports/provider-deadline.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { SqliteCollaborationPublicationRepository } from "../../src/infrastructure/database/collaboration-publication-repository.js";
import { SqliteCollaborationRepository } from "../../src/infrastructure/database/collaboration-repository.js";
import { SqliteCollaborationSessionRepository } from "../../src/infrastructure/database/collaboration-session-repository.js";
import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { ProfileService } from "../../src/application/profiles/profile-service.js";
import { SqliteProfileRepository } from "../../src/infrastructure/database/profile-repository.js";
import { SqliteTelegramUserRepository } from "../../src/infrastructure/database/telegram-user-repository.js";
import { FakeTelegramTransport } from "../../src/infrastructure/testing/fake-telegram-transport.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

class ImmediateDeadline implements ProviderDeadline {
	run<T>(_signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> { return operation(new AbortController().signal); }
}
class FixedClaim implements ClaimTokenGenerator {
	g = 0;
	generate(): string { this.g += 1; return `claim-${this.g}`; }
}

describe("S2-02 showcase publication", () => {
	it("upgrades an existing S2-01 database with only the additive publication table", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-02-upgrade-"));
		const fixture = join(directory, "migrations");
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		try {
			await mkdir(fixture);
			for (const id of ["0001_s0-04-ingress-foundation.sql", "0002_s0-05-outbox-events.sql", "0003_s1-01-profile-state.sql", "0004_s1-02-profile-sessions.sql", "0005_s1-03-telegram-first-contact.sql", "0006_s2-01-collaboration-drafts.sql"]) await copyFile(join(migrationsPath, id), join(fixture, id));
			expect((await new MigrationRunner(await MigrationSource.fromDirectory(fixture), clock).migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6]);
			await copyFile(join(migrationsPath, "0007_s2-02-channel-publications.sql"), join(fixture, "0007_s2-02-channel-publications.sql"));
			expect((await new MigrationRunner(await MigrationSource.fromDirectory(fixture), clock).migrate(boundary)).applied).toEqual([7]);
			expect(await boundary.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'channel_publications'")).toEqual([{ name: "channel_publications" }]);
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});

	it("atomically publishes one draft, projects the known message id, and lists it without opaque data", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-02-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			expect((await new MigrationRunner(source, clock).migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
			await seedProfile(boundary, clock);
			const transactions = new DatabaseBoundaryTransactionRunner(boundary);
			const collaborations = new SqliteCollaborationRepository(boundary);
			const sessions = new SqliteCollaborationSessionRepository(boundary);
			const draftService = new CollaborationDraftService(collaborations, sessions, transactions, clock);
			let current = await draftService.start("100");
			current = await draftService.saveStep("100", current.session, { format: "joint_content" }, "target_profile_type");
			current = await draftService.saveStep("100", current.session, { targetProfileType: "blogger" }, "topics");
			current = await draftService.saveStep("100", current.session, { topics: ["city"] }, "title");
			current = await draftService.saveStep("100", current.session, { title: "Городской проект" }, "offer");
			current = await draftService.saveStep("100", current.session, { offerText: "Совместный материал для аудитории города." }, "expectation");
			current = await draftService.saveStep("100", current.session, { expectationText: "Нужен партнёр для съёмки и согласования." }, "slots");
			current = await draftService.saveStep("100", current.session, { slotsTotal: 2 }, "deadline");
			current = await draftService.saveStep("100", current.session, { responseDeadlineDate: "20.11.2023" }, "event_date");
			current = await draftService.saveStep("100", current.session, { eventDateLocal: "25.11.2023" }, "preview");
			const outbox = new SqliteOutboxDeliveryRepository(boundary);
			const capability = { canPublish: true, reason: null as string | null };
			const publications = new SqliteCollaborationPublicationRepository(boundary);
			const service = new CollaborationPublicationService(collaborations, publications, sessions, outbox, transactions, clock, capability, "-1001", "collab_bot");
			const published = await service.publish("100", current.draft.id);
			expect(published.status).toBe("publishing");
			const duplicate = await service.publish("100", current.draft.id);
			expect(duplicate.deliveryId).toBe(published.deliveryId);
			const transport = new FakeTelegramTransport();
			transport.enqueueSuccess(901);
			const runner = new DeliveryRunner(outbox, transport, new ImmediateDeadline(), new FixedClaim(), clock);
			const outcomeAt = clock.now().getTime();
			expect(await runner.runOnce()).toMatchObject({ outcome: "sent", deliveryId: published.deliveryId });
			clock.advanceBy(30 * 24 * 60 * 60 * 1000);
			await service.projectDelivery(published.deliveryId!, outbox);
			expect(await collaborations.findById(current.draft.id)).toMatchObject({ status: "published", publicToken: expect.any(String) });
			expect(await boundary.query("SELECT published_at FROM collaborations WHERE id = ?", [current.draft.id])).toEqual([{ published_at: outcomeAt }]);
			expect(await service.listOwn("100")).toEqual([expect.objectContaining({ collaborationId: current.draft.id, status: "published" })]);
			const row = await publications.findByCollaborationId(current.draft.id);
			expect(row).toMatchObject({ status: "published", messageId: 901 });
			expect(JSON.stringify(row)).not.toContain("publicToken");
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});

	it("uses the durable send outcome time, creates one expired edit without a keyboard, and never reprojects it after restart", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-02-late-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		try {
			await migrateAll(boundary, clock);
			const fixture = await preparePublication(boundary, clock);
			clock.advanceBy(10 * 24 * 60 * 60 * 1000);
			const transport = new FakeTelegramTransport();
			transport.enqueueSuccess(902);
			const runner = new DeliveryRunner(fixture.outbox, transport, new ImmediateDeadline(), new FixedClaim(), clock);
			await runner.runOnce();
			await fixture.service.projectDelivery(fixture.deliveryId, fixture.outbox);
			expect(await fixture.collaborations.findById(fixture.collaborationId)).toMatchObject({ status: "expired" });
			expect(await boundary.query("SELECT published_at FROM collaborations WHERE id = ?", [fixture.collaborationId])).toEqual([{ published_at: clock.now().getTime() }]);
			const edit = await fixture.outbox.findByIdempotencyKey(`collaboration:${fixture.collaborationId}:channel_edit:expired:v1`);
			expect(edit).toMatchObject({ kind: "channel_edit", messageId: 902, payload: { method: "edit", replyMarkup: { inline_keyboard: [] } } });
			expect((edit?.payload.method === "edit" ? edit.payload.text : "")).toContain("Приём откликов завершён");
			await fixture.service.projectTerminalOutcomes(fixture.outbox);
			expect(await fixture.outbox.findByIdempotencyKey(`collaboration:${fixture.collaborationId}:channel_edit:expired:v1`)).toEqual(edit);
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});

	it("atomically cancels a retryable delivery that crosses the deadline before a claim", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-02-deadline-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		try {
			await migrateAll(boundary, clock);
			const fixture = await preparePublication(boundary, clock);
			await boundary.execute("UPDATE outbox_deliveries SET status = 'retryable_failed', attempt_count = 1, next_attempt_at = ?, last_error_kind = 'network', updated_at = ? WHERE id = ?", [clock.now().getTime() + 86_400_000, clock.now().getTime(), fixture.deliveryId]);
			clock.advanceBy(10 * 24 * 60 * 60 * 1000);
			expect(await fixture.service.cancelExpiredPrepared()).toBe(1);
			expect(await fixture.outbox.findById(fixture.deliveryId)).toMatchObject({ status: "permanent_failed", attemptCount: 1, lastErrorKind: "provider_timeout" });
			expect(await fixture.collaborations.findById(fixture.collaborationId)).toMatchObject({ status: "expired" });
			expect(await boundary.query("SELECT published_at FROM collaborations WHERE id = ?", [fixture.collaborationId])).toEqual([{ published_at: null }]);
			const transport = new FakeTelegramTransport();
			const runner = new DeliveryRunner(fixture.outbox, transport, new ImmediateDeadline(), new FixedClaim(), clock);
			expect(await runner.runOnce()).toEqual({ outcome: "idle" });
			expect(transport.calls).toHaveLength(0);
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});
});

async function migrateAll(boundary: DatabaseBoundary, clock: FakeClock): Promise<void> {
	expect((await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
}

async function preparePublication(boundary: DatabaseBoundary, clock: FakeClock): Promise<{ service: CollaborationPublicationService; outbox: SqliteOutboxDeliveryRepository; collaborations: SqliteCollaborationRepository; collaborationId: string; deliveryId: string }> {
	await seedProfile(boundary, clock);
	const transactions = new DatabaseBoundaryTransactionRunner(boundary);
	const collaborations = new SqliteCollaborationRepository(boundary);
	const sessions = new SqliteCollaborationSessionRepository(boundary);
	const drafts = new CollaborationDraftService(collaborations, sessions, transactions, clock);
	let current = await drafts.start("100");
	current = await drafts.saveStep("100", current.session, { format: "joint_content" }, "target_profile_type");
	current = await drafts.saveStep("100", current.session, { targetProfileType: "blogger" }, "topics");
	current = await drafts.saveStep("100", current.session, { topics: ["city"] }, "title");
	current = await drafts.saveStep("100", current.session, { title: "Городской проект" }, "offer");
	current = await drafts.saveStep("100", current.session, { offerText: "Совместный материал для аудитории города." }, "expectation");
	current = await drafts.saveStep("100", current.session, { expectationText: "Нужен партнёр для съёмки и согласования." }, "slots");
	current = await drafts.saveStep("100", current.session, { slotsTotal: 2 }, "deadline");
	current = await drafts.saveStep("100", current.session, { responseDeadlineDate: "20.11.2023" }, "event_date");
	current = await drafts.saveStep("100", current.session, { eventDateLocal: "25.11.2023" }, "preview");
	const outbox = new SqliteOutboxDeliveryRepository(boundary);
	const service = new CollaborationPublicationService(collaborations, new SqliteCollaborationPublicationRepository(boundary), sessions, outbox, transactions, clock, { canPublish: true, reason: null }, "-1001", "collab_bot");
	const published = await service.publish("100", current.draft.id);
	return { service, outbox, collaborations, collaborationId: current.draft.id, deliveryId: published.deliveryId! };
}

async function seedProfile(boundary: DatabaseBoundary, clock: FakeClock): Promise<void> {
	const now = clock.now().getTime();
	await new SqliteTelegramUserRepository(boundary).upsert({ telegramUserId: "100", username: "alice", displayName: "Alice", updatedAt: now });
	await new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock).create("100", { type: "blogger", displayName: "Alice", description: "A useful local profile.", topics: ["city"], platforms: [{ platformType: "website", url: "https://example.com/alice" }] });
}
