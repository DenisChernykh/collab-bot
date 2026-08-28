import { fileURLToPath } from "node:url";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import { SqliteTelegramUserRepository } from "../../src/platform/database/telegram-user-repository.js";
import { FakeClock } from "../support/fake-clock.js";
import { CollaborationDraftService } from "../../src/modules/collaborations/index.js";
import { SqliteCollaborationRepository } from "../../src/modules/collaborations/infrastructure/sqlite-collaboration-repository.js";
import { SqliteCollaborationSessionRepository } from "../../src/modules/collaborations/infrastructure/sqlite-collaboration-session-repository.js";
import { ProfileService } from "../../src/modules/profiles/index.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { SqliteProfileSessionRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-session-repository.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("S2-01 collaboration persistence", () => {
	it("round-trips an event date through Back, supports explicit removal, and resumes after reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-01-event-date-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		let boundary = new DatabaseBoundary(databasePath);
		try {
			await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
			await seedProfile(boundary, clock);
			const service = createService(boundary, clock);
			let current = await service.start("100");
			for (const [input, step] of [
				[{ format: "joint_content" }, "target_profile_type"], [{ targetProfileType: "blogger" }, "topics"], [{ topics: ["city"] }, "title"], [{ title: "Городской проект" }, "offer"],
				[{ offerText: "Снимем совместный материал для аудитории." }, "expectation"], [{ expectationText: "Нужен партнёр для съёмки и согласования." }, "slots"], [{ slotsTotal: 2 }, "deadline"], [{ responseDeadlineDate: "20.11.2023" }, "event_date"], [{ eventDateLocal: "25.11.2023" }, "preview"],
			] as const) current = await service.saveStep("100", current.session, input, step as never);
			current = await service.saveStep("100", current.session, {}, "event_date");
			current = await service.saveStep("100", current.session, { eventDateLocal: null }, "preview");
			expect(current.draft.eventDateLocal).toBeNull();
			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			expect(await createService(boundary, clock).findSession("100")).toMatchObject({ state: { step: "preview" } });
			expect(await new SqliteCollaborationRepository(boundary).findDraftByTelegramUserId("100")).toMatchObject({ eventDateLocal: null });
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});

	it("keeps a persisted draft traversable on its deadline day after close and reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-01-deadline-day-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		let boundary = new DatabaseBoundary(databasePath);
		try {
			await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
			await seedProfile(boundary, clock);
			const service = createService(boundary, clock);
			let current = await service.start("100");
			for (const [input, step] of [
				[{ format: "joint_content" }, "target_profile_type"], [{ targetProfileType: "blogger" }, "topics"], [{ topics: ["city"] }, "title"], [{ title: "Городской проект" }, "offer"],
				[{ offerText: "Снимем совместный материал для аудитории." }, "expectation"], [{ expectationText: "Нужен партнёр для съёмки и согласования." }, "slots"], [{ slotsTotal: 2 }, "deadline"], [{ responseDeadlineDate: "20.11.2023" }, "event_date"], [{ eventDateLocal: "25.11.2023" }, "preview"],
			] as const) current = await service.saveStep("100", current.session, input, step as never);
			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			clock.set(new Date("2023-11-20T07:00:00.000Z"));
			const resumedService = createService(boundary, clock);
			const resumed = await resumedService.start("100");
			expect(resumed.session.state.step).toBe("preview");
			const eventDate = await resumedService.saveStep("100", resumed.session, {}, "event_date");
			const deadline = await resumedService.saveStep("100", eventDate.session, {}, "deadline");
			expect(deadline.session.state.step).toBe("deadline");
			expect(deadline.draft.responseDeadlineAt).toBe(resumed.draft.responseDeadlineAt);
		} finally {
			try { await boundary.close(); } catch { /* already closed in reopen path */ }
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("upgrades 0005 to 0006 and keeps the draft/session durable across reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-01-upgrade-"));
		const fixture = join(directory, "migrations");
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		await mkdir(fixture);
		for (const filename of ["0001_s0-04-ingress-foundation.sql", "0002_s0-05-outbox-events.sql", "0003_s1-01-profile-state.sql", "0004_s1-02-profile-sessions.sql", "0005_s1-03-telegram-first-contact.sql"]) await copyFile(join(migrationsPath, filename), join(fixture, filename));
		const boundary = new DatabaseBoundary(databasePath);
		try {
			const oldSource = await MigrationSource.fromDirectory(fixture);
			expect((await new MigrationRunner(oldSource, clock).migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5]);
			await copyFile(join(migrationsPath, "0006_s2-01-collaboration-drafts.sql"), join(fixture, "0006_s2-01-collaboration-drafts.sql"));
			const source = await MigrationSource.fromDirectory(fixture);
			expect((await new MigrationRunner(source, clock).migrate(boundary)).applied).toEqual([6]);
			await seedProfile(boundary, clock);
			const service = createService(boundary, clock);
			const started = await service.start("100");
			expect(started.draft.publicToken).toBeNull();
			expect(started.session.state.step).toBe("format");
			let current = started;
			current = await service.saveStep("100", current.session, { format: "joint_content" }, "target_profile_type");
			current = await service.saveStep("100", current.session, { targetProfileType: "blogger" }, "topics");
			current = await service.saveStep("100", current.session, { topics: ["city"] }, "title");
			current = await service.saveStep("100", current.session, { title: "Городской проект" }, "offer");
			current = await service.saveStep("100", current.session, { offerText: "Снимем совместный материал для аудитории." }, "expectation");
			current = await service.saveStep("100", current.session, { expectationText: "Нужен партнёр для съёмки и согласования." }, "slots");
			current = await service.saveStep("100", current.session, { slotsTotal: 2 }, "deadline");
			current = await service.saveStep("100", current.session, { responseDeadlineDate: "20.11.2023" }, "event_date");
			current = await service.saveStep("100", current.session, { eventDateLocal: "25.11.2023" }, "preview");
			expect(current.draft.title).toBe("Городской проект");
			expect(current.session.state.step).toBe("preview");
			expect(await new SqliteCollaborationRepository(boundary).findDraftByIdForTelegramUser("101", current.draft.id)).toBeUndefined();
			await boundary.close();
			const reopened = new DatabaseBoundary(databasePath);
			try {
				const resumed = createService(reopened, clock);
				expect(await resumed.findSession("100")).toMatchObject({ collaborationId: current.draft.id, state: { step: "preview" } });
				expect(await resumed.findDraft("100")).toMatchObject({ id: current.draft.id, title: "Городской проект", publicToken: null });
				await resumed.cancel("100");
				expect(await resumed.cancel("100")).toBe(false);
				expect(await resumed.findDraft("100")).toBeUndefined();
				expect(await resumed.findSession("100")).toBeUndefined();
			} finally { await reopened.close(); }
		} finally {
			try { await boundary.close(); } catch { /* already closed in reopen path */ }
			await rm(directory, { recursive: true, force: true });
		}
	});
});

function createService(boundary: DatabaseBoundary, clock: FakeClock): CollaborationDraftService {
	return new CollaborationDraftService(
		new SqliteCollaborationRepository(boundary),
		new SqliteCollaborationSessionRepository(boundary),
		new DatabaseBoundaryTransactionRunner(boundary),
		clock,
		webCryptoCapabilities,
		new SqliteProfileSessionRepository(boundary),
	);
}

async function seedProfile(boundary: DatabaseBoundary, clock: FakeClock): Promise<void> {
	const now = clock.now().getTime();
	await new SqliteTelegramUserRepository(boundary).upsert({ telegramUserId: "100", username: "alice", displayName: "Alice", updatedAt: now });
	const profiles = new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock);
	await profiles.create("100", { type: "blogger", displayName: "Alice", description: "A useful local profile.", topics: ["city"], platforms: [{ platformType: "website", url: "https://example.com/alice" }] });
}
