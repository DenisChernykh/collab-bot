import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AdminModerationService } from "../../src/application/moderation/admin-moderation-service.js";
import { DurableCommandExecutor } from "../../src/application/commands/command-executor.js";
import { DeliveryRunner } from "../../src/application/outbox/delivery-runner.js";
import { OutboxDeliveryService } from "../../src/application/outbox/outbox-service.js";
import type { ClaimTokenGenerator } from "../../src/application/ports/claim-token.js";
import type { ProviderDeadline } from "../../src/application/ports/provider-deadline.js";
import { TelegramTransportError } from "../../src/application/ports/telegram-transport.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";
import { SqliteAdminModerationRepository } from "../../src/infrastructure/database/admin-moderation-repository.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { FakeTelegramTransport } from "../../src/infrastructure/testing/fake-telegram-transport.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;
const BOT_USERNAME = "collab_bot";
const ADMIN_ID = "900123456789";
const OUTSIDER_ID = "901123456789";
const AUTHOR_ID = "100123456789";
const PENDING_ID = "200123456789";
const ACCEPTED_ID = "300123456789";
const AUTHOR_PROFILE_ID = id("1", "1");
const PENDING_PROFILE_ID = id("2", "1");
const ACCEPTED_PROFILE_ID = id("3", "1");
const PUBLISHED_CARD_ID = id("a", "3");
const MATCHED_CARD_ID = id("b", "3");
const COMPLETED_CARD_ID = id("c", "3");
const CANCELLED_CARD_ID = id("d", "3");
const EXPIRED_CARD_ID = id("e", "3");
const TOKENS = {
	published: "AAAAAAAAAAAAAAAAAAAAAA",
	matched: "BBBBBBBBBBBBBBBBBBBBBB",
	completed: "CCCCCCCCCCCCCCCCCCCCCC",
	cancelled: "DDDDDDDDDDDDDDDDDDDDDD",
	expired: "EEEEEEEEEEEEEEEEEEEEEE",
} as const;

describe("S4-01 moderation migration", () => {
	it("applies fresh schema with hidden overlay and append-only operator audit", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s4-fresh-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		try {
			const runner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), new FakeClock(NOW));
			expect((await runner.migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
			expect(await boundary.query("SELECT name FROM pragma_table_info('collaborations') WHERE name IN ('hidden_at', 'hidden_from_status') ORDER BY name")).toEqual([
				{ name: "hidden_at" },
				{ name: "hidden_from_status" },
			]);
			expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_actions'")).toEqual([{ name: "operator_actions" }]);
			await runner.verify(boundary);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("upgrades populated 0011 data without changing authoritative rows and survives reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s4-upgrade-"));
		const fixturePath = join(directory, "migrations");
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(NOW);
		let boundary = new DatabaseBoundary(databasePath);
		try {
			await copyMigrationsThrough0011(fixturePath);
			const previous = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			expect((await previous.migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
			await seedUser(boundary, AUTHOR_ID);
			await seedProfile(boundary, AUTHOR_ID, AUTHOR_PROFILE_ID, "Upgrade author");
			await seedCard(boundary, PUBLISHED_CARD_ID, TOKENS.published, "published", 701);

			await copyFile(join(migrationsPath, "0012_s4-01-admin-hide.sql"), join(fixturePath, "0012_s4-01-admin-hide.sql"));
			const upgraded = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			expect((await upgraded.migrate(boundary)).applied).toEqual([12]);
			expect(await boundary.query("SELECT id, status, projection_revision, hidden_from_status, hidden_at FROM collaborations")).toEqual([{
				id: PUBLISHED_CARD_ID,
				status: "published",
				projection_revision: 0,
				hidden_from_status: null,
				hidden_at: null,
			}]);
			expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);

			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await expect(upgraded.migrate(boundary)).resolves.toMatchObject({ noOp: true });
			expect(await boundary.query("SELECT id, status, hidden_from_status, hidden_at FROM collaborations")).toEqual([{
				id: PUBLISHED_CARD_ID,
				status: "published",
				hidden_from_status: null,
				hidden_at: null,
			}]);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("fails closed when legacy hidden rows have no recoverable business status", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s4-hidden-guard-"));
		const fixturePath = join(directory, "migrations");
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		const clock = new FakeClock(NOW);
		try {
			await copyMigrationsThrough0011(fixturePath);
			const previous = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			await previous.migrate(boundary);
			await seedUser(boundary, AUTHOR_ID);
			await seedProfile(boundary, AUTHOR_ID, AUTHOR_PROFILE_ID, "Legacy hidden author");
			await seedCard(boundary, PUBLISHED_CARD_ID, TOKENS.published, "hidden", 701);
			await copyFile(join(migrationsPath, "0012_s4-01-admin-hide.sql"), join(fixturePath, "0012_s4-01-admin-hide.sql"));

			const upgraded = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			await expect(upgraded.migrate(boundary)).rejects.toThrow(/hidden/i);
			expect(await boundary.query("SELECT name FROM pragma_table_info('collaborations') WHERE name = 'hidden_from_status'")).toEqual([]);
			expect(await boundary.query("SELECT id FROM __app_migrations ORDER BY id DESC LIMIT 1")).toEqual([{ id: 11 }]);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("S4-01 allowlisted admin hide", () => {
	it("atomically hides, closes pending only, audits, enqueues one known-target delete and replays once", async () => {
		await withModerationFixture(async (fixture) => {
			const link = deepLink(TOKENS.published);
			expect(await fixture.service.lookup({ adminTelegramUserId: ADMIN_ID, deepLink: link })).toMatchObject({
				ok: true,
				title: "Card a",
				status: "published",
			});
			expect(await fixture.service.lookup({ adminTelegramUserId: OUTSIDER_ID, deepLink: link })).toEqual({ ok: false, code: "forbidden" });

			const execute = () => executeHide(fixture, 101, link, "Нарушение правил первого запуска");
			expect(await execute()).toMatchObject({ outcome: "completed", entityId: PUBLISHED_CARD_ID });
			expect(await execute()).toMatchObject({ outcome: "completed", entityId: PUBLISHED_CARD_ID });

			expect(await fixture.boundary.query("SELECT status, projection_revision, version, hidden_from_status, hidden_at FROM collaborations WHERE id = ?", [PUBLISHED_CARD_ID])).toEqual([{
				status: "hidden",
				projection_revision: 1,
				version: 1,
				hidden_from_status: "published",
				hidden_at: NOW,
			}]);
			expect(await fixture.boundary.query("SELECT status FROM applications WHERE collaboration_id = ? ORDER BY id", [PUBLISHED_CARD_ID])).toEqual([
				{ status: "closed" },
				{ status: "accepted" },
			]);
			expect(await fixture.boundary.query("SELECT status, decided_by_profile_id, decided_at FROM applications WHERE collaboration_id = ? ORDER BY id", [PUBLISHED_CARD_ID])).toEqual([
				{ status: "closed", decided_by_profile_id: null, decided_at: null },
				{ status: "accepted", decided_by_profile_id: AUTHOR_PROFILE_ID, decided_at: NOW },
			]);
			expect(await fixture.boundary.query("SELECT actor_telegram_user_id, collaboration_id, action_type, reason, command_id, before_state_json, after_state_json FROM operator_actions")).toEqual([{
				actor_telegram_user_id: ADMIN_ID,
				collaboration_id: PUBLISHED_CARD_ID,
				action_type: "hide_collaboration",
				reason: "Нарушение правил первого запуска",
				command_id: "telegram:update:101",
				before_state_json: JSON.stringify({ status: "published", projectionRevision: 0 }),
				after_state_json: JSON.stringify({ status: "hidden", projectionRevision: 1 }),
			}]);
			const deliveries = await fixture.boundary.query<Record<string, unknown>>("SELECT id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status FROM outbox_deliveries WHERE kind = 'channel_delete'");
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0]).toMatchObject({
				idempotency_key: `channel:${PUBLISHED_CARD_ID}:hide:1`,
				kind: "channel_delete",
				recipient_chat_id: "-1001",
				message_id: 701,
				payload_json: JSON.stringify({ version: 1, method: "delete" }),
				status: "prepared",
			});
			expect(await fixture.boundary.query("SELECT last_delivery_id FROM channel_publications WHERE collaboration_id = ?", [PUBLISHED_CARD_ID])).toEqual([{ last_delivery_id: deliveries[0]?.id }]);
			expect(await fixture.boundary.query("SELECT source, telegram_update_id FROM command_receipts WHERE command_id = 'telegram:update:101'")).toEqual([{ source: "telegram", telegram_update_id: 101 }]);
			expect(await fixture.boundary.query("SELECT update_id FROM processed_updates WHERE update_id = 101")).toEqual([{ update_id: 101 }]);
			await expect(fixture.boundary.execute("UPDATE operator_actions SET reason = 'changed'")).rejects.toThrow(/append-only/i);
			await expect(fixture.boundary.execute("DELETE FROM operator_actions")).rejects.toThrow(/append-only/i);
			await expect(fixture.boundary.execute("UPDATE collaborations SET hidden_from_status = 'expired' WHERE id = ?", [PUBLISHED_CARD_ID])).rejects.toThrow(/overlay/i);

			expect(await executeHide(fixture, 102, link, "Повторная команда с другим update")).toMatchObject({ outcome: "ok", messageKey: "collaboration_already_hidden" });
			expect(await count(fixture.boundary, "operator_actions")).toBe(1);
			expect(await count(fixture.boundary, "outbox_deliveries", "kind = 'channel_delete'")).toBe(1);
		});
	});

	it("supports every documented business status with a known showcase message", async () => {
		await withModerationFixture(async (fixture) => {
			const cases = [
				[TOKENS.matched, MATCHED_CARD_ID, "matched", "x"],
				[TOKENS.completed, COMPLETED_CARD_ID, "completed", "x".repeat(500)],
				[TOKENS.cancelled, CANCELLED_CARD_ID, "cancelled", "Скрытие отменённой карточки"],
				[TOKENS.expired, EXPIRED_CARD_ID, "expired", "Скрытие истёкшей карточки"],
			] as const;
			let updateId = 200;
			for (const [token, cardId, previousStatus, reason] of cases) {
				expect(await executeHide(fixture, updateId++, deepLink(token), reason)).toMatchObject({ outcome: "completed", entityId: cardId });
				expect(await fixture.boundary.query("SELECT status, hidden_from_status, projection_revision FROM collaborations WHERE id = ?", [cardId])).toEqual([{
					status: "hidden",
					hidden_from_status: previousStatus,
					projection_revision: 1,
				}]);
			}
			expect(await count(fixture.boundary, "operator_actions")).toBe(4);
			expect(await count(fixture.boundary, "outbox_deliveries", "kind = 'channel_delete'")).toBe(4);
		});
	});

	it("rejects malformed, wrong-bot, unknown, non-admin and invalid-reason commands without mutation", async () => {
		await withModerationFixture(async (fixture) => {
			expect(await fixture.service.lookup({ adminTelegramUserId: ADMIN_ID, deepLink: "not-a-link" })).toEqual({ ok: false, code: "invalid_link" });
			expect(await fixture.service.lookup({ adminTelegramUserId: ADMIN_ID, deepLink: deepLink(TOKENS.published, "other_bot") })).toEqual({ ok: false, code: "invalid_link" });
			expect(await fixture.service.lookup({ adminTelegramUserId: ADMIN_ID, deepLink: `${deepLink(TOKENS.published)}&extra=1` })).toEqual({ ok: false, code: "invalid_link" });
			expect(await fixture.service.lookup({ adminTelegramUserId: ADMIN_ID, deepLink: `${deepLink(TOKENS.published)}#fragment` })).toEqual({ ok: false, code: "invalid_link" });
			expect(await fixture.service.lookup({ adminTelegramUserId: ADMIN_ID, deepLink: deepLink("Z".repeat(22)) })).toEqual({ ok: false, code: "not_found" });
			expect(await fixture.service.hide({ adminTelegramUserId: OUTSIDER_ID, commandId: "telegram:update:300", deepLink: deepLink(TOKENS.published), reason: "Forbidden" })).toEqual({ ok: false, code: "forbidden" });
			expect(await fixture.service.hide({ adminTelegramUserId: ADMIN_ID, commandId: "telegram:update:301", deepLink: deepLink(TOKENS.published), reason: "   " })).toEqual({ ok: false, code: "invalid_reason" });
			expect(await fixture.service.hide({ adminTelegramUserId: ADMIN_ID, commandId: "telegram:update:302", deepLink: deepLink(TOKENS.published), reason: "x".repeat(501) })).toEqual({ ok: false, code: "invalid_reason" });
			await fixture.boundary.execute("DELETE FROM channel_publications WHERE collaboration_id = ?", [EXPIRED_CARD_ID]);
			expect(await fixture.service.hide({ adminTelegramUserId: ADMIN_ID, commandId: "telegram:update:303", deepLink: deepLink(TOKENS.expired), reason: "Нет известного showcase post" })).toEqual({ ok: false, code: "unavailable" });
			expect(await count(fixture.boundary, "operator_actions")).toBe(0);
			expect(await count(fixture.boundary, "outbox_deliveries", "kind = 'channel_delete'")).toBe(0);
			expect(await fixture.boundary.query("SELECT status FROM collaborations WHERE id = ?", [PUBLISHED_CARD_ID])).toEqual([{ status: "published" }]);
		});
	});

	it("rolls back the card, applications and audit when the durable delete conflicts", async () => {
		await withModerationFixture(async (fixture) => {
			await fixture.boundary.execute(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, 'channel_delete', '-1001', 999, ?, 'prepared', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)",
				[id("9", "5"), `channel:${PUBLISHED_CARD_ID}:hide:1`, JSON.stringify({ version: 1, method: "delete" }), NOW, NOW],
			);
			await expect(executeHide(fixture, 401, deepLink(TOKENS.published), "Должно полностью откатиться")).rejects.toThrow(/idempotency/i);
			expect(await fixture.boundary.query("SELECT status, projection_revision, hidden_from_status, hidden_at FROM collaborations WHERE id = ?", [PUBLISHED_CARD_ID])).toEqual([{
				status: "published",
				projection_revision: 0,
				hidden_from_status: null,
				hidden_at: null,
			}]);
			expect(await fixture.boundary.query("SELECT status FROM applications WHERE collaboration_id = ? ORDER BY id", [PUBLISHED_CARD_ID])).toEqual([{ status: "pending" }, { status: "accepted" }]);
			expect(await count(fixture.boundary, "operator_actions")).toBe(0);
			expect(await count(fixture.boundary, "command_receipts", "command_id = 'telegram:update:401'")).toBe(0);
		});
	});

	it("keeps hidden state authoritative when delete is not-found or exhausts retries", async () => {
		await withModerationFixture(async (fixture) => {
			const repository = new SqliteOutboxDeliveryRepository(fixture.boundary);
			const transport = new FakeTelegramTransport();
			const runner = new DeliveryRunner(repository, transport, new ImmediateDeadline(), new FixedClaimTokens(), fixture.clock);

			await executeHide(fixture, 450, deepLink(TOKENS.published), "Пост уже мог быть удалён вручную");
			transport.enqueueFailure(new TelegramTransportError({ code: "message_not_found" }));
			expect(await runner.runOnce()).toMatchObject({ outcome: "sent" });
			expect(await fixture.boundary.query("SELECT status FROM collaborations WHERE id = ?", [PUBLISHED_CARD_ID])).toEqual([{ status: "hidden" }]);

			await executeHide(fixture, 451, deepLink(TOKENS.matched), "Telegram стабильно отклоняет удаление");
			for (let attempt = 1; attempt <= 5; attempt += 1) {
				transport.enqueueFailure(new TelegramTransportError({ code: "network", phase: "pre_send" }));
				expect(await runner.runOnce()).toMatchObject({ outcome: attempt === 5 ? "permanent_failed" : "retryable_failed" });
				const rows = await fixture.boundary.query<{ next_attempt_at: number | null }>(
					"SELECT next_attempt_at FROM outbox_deliveries WHERE idempotency_key = ?",
					[`channel:${MATCHED_CARD_ID}:hide:1`],
				);
				if (rows[0]?.next_attempt_at !== null && rows[0]?.next_attempt_at !== undefined) fixture.clock.set(rows[0].next_attempt_at);
			}
			expect(await fixture.boundary.query("SELECT status FROM collaborations WHERE id = ?", [MATCHED_CARD_ID])).toEqual([{ status: "hidden" }]);
			expect(await fixture.boundary.query("SELECT status, attempt_count FROM outbox_deliveries WHERE idempotency_key = ?", [`channel:${MATCHED_CARD_ID}:hide:1`])).toEqual([{ status: "permanent_failed", attempt_count: 5 }]);
		});
	});
});

class FixedClaimTokens implements ClaimTokenGenerator {
	private index = 0;
	generate(): string { this.index += 1; return `s4-claim-${this.index}`; }
}

class ImmediateDeadline implements ProviderDeadline {
	run<T>(_shutdownSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return operation(new AbortController().signal);
	}
}

interface ModerationFixture {
	readonly boundary: DatabaseBoundary;
	readonly clock: FakeClock;
	readonly service: AdminModerationService;
	readonly executor: DurableCommandExecutor;
}

async function withModerationFixture(work: (fixture: ModerationFixture) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s4-hide-"));
	const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
	const clock = new FakeClock(NOW);
	try {
		await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
		await seedFixture(boundary);
		const transactions = new DatabaseBoundaryTransactionRunner(boundary);
		const outboxStore = new SqliteOutboxDeliveryRepository(boundary);
		const service = new AdminModerationService({
			repository: new SqliteAdminModerationRepository(boundary),
			outbox: new OutboxDeliveryService(outboxStore, transactions, clock),
			transactions,
			clock,
			botUsername: BOT_USERNAME,
			adminTelegramIds: [ADMIN_ID],
		});
		const executor = new DurableCommandExecutor(transactions, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
		await work({ boundary, clock, service, executor });
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

async function executeHide(fixture: ModerationFixture, updateId: number, link: string, reason: string) {
	return fixture.executor.execute({
		context: {
			commandId: `telegram:update:${updateId}`,
			telegramUpdateId: updateId,
			actor: { kind: "admin", telegramUserId: ADMIN_ID },
			occurredAt: new Date(NOW),
		},
		input: { kind: "message", text: `/admin hide ${link} ${reason}` },
		effect: async () => {
			const result = await fixture.service.hide({
				adminTelegramUserId: ADMIN_ID,
				commandId: `telegram:update:${updateId}`,
				deepLink: link,
				reason,
			});
			if (!result.ok) return { version: 1, outcome: "ok", messageKey: result.code === "already_hidden" ? "collaboration_already_hidden" : "collaboration_unavailable" } as const;
			return { version: 1, outcome: "completed", messageKey: "command_completed", entityId: result.collaborationId } as const;
		},
	});
}

async function seedFixture(boundary: DatabaseBoundary): Promise<void> {
	for (const userId of [ADMIN_ID, OUTSIDER_ID, AUTHOR_ID, PENDING_ID, ACCEPTED_ID]) await seedUser(boundary, userId);
	await seedProfile(boundary, AUTHOR_ID, AUTHOR_PROFILE_ID, "Author");
	await seedProfile(boundary, PENDING_ID, PENDING_PROFILE_ID, "Pending applicant");
	await seedProfile(boundary, ACCEPTED_ID, ACCEPTED_PROFILE_ID, "Accepted applicant");
	await seedCard(boundary, PUBLISHED_CARD_ID, TOKENS.published, "published", 701);
	await seedCard(boundary, MATCHED_CARD_ID, TOKENS.matched, "matched", 702);
	await seedCard(boundary, COMPLETED_CARD_ID, TOKENS.completed, "completed", 703);
	await seedCard(boundary, CANCELLED_CARD_ID, TOKENS.cancelled, "cancelled", 704);
	await seedCard(boundary, EXPIRED_CARD_ID, TOKENS.expired, "expired", 705);
	await seedApplication(boundary, id("4", "4"), PUBLISHED_CARD_ID, PENDING_PROFILE_ID, "pending");
	await seedApplication(boundary, id("5", "4"), PUBLISHED_CARD_ID, ACCEPTED_PROFILE_ID, "accepted");
}

async function seedUser(boundary: DatabaseBoundary, telegramUserId: string): Promise<void> {
	await boundary.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, ?, 'active', NULL, ?, ?)",
		[telegramUserId, `User ${telegramUserId}`, NOW - DAY, NOW - DAY],
	);
}

async function seedProfile(boundary: DatabaseBoundary, telegramUserId: string, profileId: string, displayName: string): Promise<void> {
	await boundary.execute(
		"INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, 'blogger', ?, 'ekaterinburg', 'active', ?, ?, NULL)",
		[profileId, telegramUserId, displayName, NOW - DAY, NOW - DAY],
	);
	await boundary.execute(
		"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, 'website', ?, NULL, NULL, NULL, NULL)",
		[`${profileId.slice(0, 8)}-0000-4000-8000-000000000002`, profileId, `https://example.com/${telegramUserId}`],
	);
}

async function seedCard(
	boundary: DatabaseBoundary,
	cardId: string,
	token: string,
	status: "published" | "matched" | "completed" | "cancelled" | "expired" | "hidden",
	messageId: number,
): Promise<void> {
	const matchedAt = status === "matched" || status === "completed" ? NOW - 100 : null;
	await boundary.execute(
		"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at, published_at, first_application_at, matched_at) VALUES (?, ?, ?, 'joint_content', 'blogger', ?, 'Совместный материал для аудитории города.', 'Нужен партнёр для съёмки и согласования.', 3, ?, NULL, 'ekaterinburg', ?, 1, 0, ?, ?, ?, NULL, ?)",
		[cardId, token, AUTHOR_PROFILE_ID, `Card ${cardId[0]}`, NOW + DAY, status, NOW - DAY, NOW, NOW - DAY, matchedAt],
	);
	await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, 'city')", [cardId]);
	await boundary.execute(
		"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', ?, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
		[cardId, messageId, (cardId[0] ?? "a").repeat(64), NOW],
	);
}

async function seedApplication(
	boundary: DatabaseBoundary,
	applicationId: string,
	collaborationId: string,
	applicantProfileId: string,
	status: "pending" | "accepted",
): Promise<void> {
	await boundary.execute(
		"INSERT INTO applications (id, collaboration_id, applicant_profile_id, message, terms_version, collaboration_version, status, decided_by_profile_id, decided_at, created_at) VALUES (?, ?, ?, 'Подробное тестовое сообщение кандидата.', 1, 1, ?, ?, ?, ?)",
		[applicationId, collaborationId, applicantProfileId, status, status === "accepted" ? AUTHOR_PROFILE_ID : null, status === "accepted" ? NOW : null, NOW - 100],
	);
}

async function copyMigrationsThrough0011(fixturePath: string): Promise<void> {
	await mkdir(fixturePath);
	for (const filename of migrationNamesThrough0011()) await copyFile(join(migrationsPath, filename), join(fixturePath, filename));
}

function migrationNamesThrough0011(): readonly string[] {
	return [
		"0001_s0-04-ingress-foundation.sql",
		"0002_s0-05-outbox-events.sql",
		"0003_s1-01-profile-state.sql",
		"0004_s1-02-profile-sessions.sql",
		"0005_s1-03-telegram-first-contact.sql",
		"0006_s2-01-collaboration-drafts.sql",
		"0007_s2-02-channel-publications.sql",
		"0008_s3-01-minimal-profiles.sql",
		"0009_s3-02-browse.sql",
		"0010_s3-03-applications.sql",
		"0011_s3-04-application-decisions.sql",
	];
}

async function count(boundary: DatabaseBoundary, table: string, where?: string): Promise<number> {
	const rows = await boundary.query<{ count: number }>(`SELECT count(*) AS count FROM ${table}${where === undefined ? "" : ` WHERE ${where}`}`);
	return rows[0]?.count ?? -1;
}

function deepLink(token: string, username = BOT_USERNAME): string {
	return `https://t.me/${username}?start=c_${token}`;
}

function id(prefix: string, suffix: string): string {
	return `${prefix.repeat(8)}-0000-4000-8000-00000000000${suffix}`;
}
