import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ApplicationService } from "../../src/application/applications/application-service.js";
import { DurableCommandExecutor } from "../../src/application/commands/command-executor.js";
import type { OutboxDeliveryStore } from "../../src/application/ports/outbox-delivery-store.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { SqliteCollaborationBrowseRepository } from "../../src/infrastructure/database/collaboration-browse-repository.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const BOT_USERNAME = "collab_bot";

const USERS = {
	author: "100123456789",
	first: "200123456789",
	second: "300123456789",
	third: "400123456789",
	outsider: "500123456789",
} as const;

const PROFILES = {
	author: profileId(1),
	first: profileId(2),
	second: profileId(3),
	third: profileId(4),
	outsider: profileId(5),
} as const;

const CARDS = {
	twoSlots: cardId("1"),
	lastSlot: cardId("2"),
	manualClose: cardId("3"),
	reject: cardId("4"),
	privacy: cardId("5"),
} as const;

const TOKENS = {
	twoSlots: "AAAAAAAAAAAAAAAAAAAAAA",
	lastSlot: "BBBBBBBBBBBBBBBBBBBBBB",
	manualClose: "CCCCCCCCCCCCCCCCCCCCCC",
	reject: "DDDDDDDDDDDDDDDDDDDDDD",
	privacy: "EEEEEEEEEEEEEEEEEEEEEE",
} as const;

describe("S3-04 application-decision migration", () => {
	it("applies a fresh 0011 schema with lifecycle and decision guards", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-04-fresh-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		try {
			const runner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), new FakeClock(NOW));
			expect((await runner.migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
			expect(await boundary.query("SELECT name FROM pragma_table_info('collaborations') WHERE name = 'matched_at'")).toEqual([
				{ name: "matched_at" },
			]);
			expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'applications' ORDER BY name")).toEqual(expect.arrayContaining([
				{ name: "applications_applicant_created" },
				{ name: "applications_collaboration_status_created" },
				{ name: "applications_one_per_profile" },
			]));
			await runner.verify(boundary);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("upgrades populated 0010 data, backfills legacy matched time, preserves every FK graph, and survives reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-04-upgrade-"));
		const fixturePath = join(directory, "migrations");
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(NOW);
		let boundary = new DatabaseBoundary(databasePath);
		try {
			await mkdir(fixturePath);
			for (const filename of migrationNamesThrough0010()) {
				await copyFile(join(migrationsPath, filename), join(fixturePath, filename));
			}
			const previous = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			expect((await previous.migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

			await seedUser(boundary, USERS.author, null);
			await seedProfile(boundary, USERS.author, PROFILES.author, "Legacy author");
			await seedUser(boundary, USERS.first, "legacy_candidate");
			await seedProfile(boundary, USERS.first, PROFILES.first, "Legacy candidate");
			await insertCard(boundary, {
				id: CARDS.twoSlots,
				token: TOKENS.twoSlots,
				authorProfileId: PROFILES.author,
				slotsTotal: 2,
				status: "published",
				updatedAt: NOW - 200,
			});
			await insertCard(boundary, {
				id: CARDS.lastSlot,
				token: TOKENS.lastSlot,
				authorProfileId: PROFILES.author,
				slotsTotal: 1,
				status: "matched",
				updatedAt: NOW - 100,
			});
			await insertApplication(boundary, applicationId(1), CARDS.twoSlots, PROFILES.first, "Сохранённый pending отклик для upgrade.");
			await boundary.execute(
				"INSERT INTO browse_sessions (telegram_user_id, generation, target_profile_type_filter, format_filter, topic_filter, cursor_published_at, cursor_collaboration_id, revision, expires_at, updated_at) VALUES (?, 'abcdef0123456789', NULL, NULL, 'city', ?, ?, 3, ?, ?)",
				[USERS.first, NOW - 200, CARDS.twoSlots, NOW + DAY, NOW],
			);
			await boundary.execute(
				"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, 'application.accept', ?, 0, 'one_shot', ?, NULL, NULL)",
				["a".repeat(64), USERS.author, `application:${applicationId(1)}`, NOW + DAY],
			);
			await boundary.execute(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, 'legacy.decision.dm', 'dm_send', ?, NULL, ?, 'prepared', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)",
				[deliveryId(1), USERS.author, JSON.stringify({ version: 1, method: "send", text: "legacy decision delivery" }), NOW, NOW],
			);

			await copyFile(join(migrationsPath, "0011_s3-04-application-decisions.sql"), join(fixturePath, "0011_s3-04-application-decisions.sql"));
			const upgraded = new MigrationRunner(await MigrationSource.fromDirectory(fixturePath), clock);
			expect((await upgraded.migrate(boundary)).applied).toEqual([11]);
			expect(await boundary.query("SELECT id, status, matched_at FROM collaborations ORDER BY id")).toEqual([
				{ id: CARDS.twoSlots, status: "published", matched_at: null },
				{ id: CARDS.lastSlot, status: "matched", matched_at: NOW - 100 },
			]);
			expect(await boundary.query("SELECT id, telegram_user_id FROM profiles ORDER BY id")).toEqual([
				{ id: PROFILES.author, telegram_user_id: USERS.author },
				{ id: PROFILES.first, telegram_user_id: USERS.first },
			]);
			expect(await boundary.query("SELECT id, profile_id FROM profile_platforms ORDER BY id")).toEqual([
				{ id: platformId(1), profile_id: PROFILES.author },
				{ id: platformId(2), profile_id: PROFILES.first },
			]);
			expect(await boundary.query("SELECT collaboration_id, topic FROM collaboration_topics ORDER BY collaboration_id")).toEqual([
				{ collaboration_id: CARDS.twoSlots, topic: "city" },
				{ collaboration_id: CARDS.lastSlot, topic: "city" },
			]);
			expect(await boundary.query("SELECT collaboration_id, message_id, status FROM channel_publications ORDER BY collaboration_id")).toEqual([
				{ collaboration_id: CARDS.twoSlots, message_id: 286331853, status: "published" },
				{ collaboration_id: CARDS.lastSlot, message_id: 572663006, status: "published" },
			]);
			expect(await boundary.query("SELECT id, status FROM applications")).toEqual([{ id: applicationId(1), status: "pending" }]);
			expect(await boundary.query("SELECT telegram_user_id, cursor_collaboration_id, revision FROM browse_sessions")).toEqual([
				{ telegram_user_id: USERS.first, cursor_collaboration_id: CARDS.twoSlots, revision: 3 },
			]);
			expect(await boundary.query("SELECT token_hash, actor_telegram_user_id, entity_id FROM telegram_actions")).toEqual([
				{ token_hash: "a".repeat(64), actor_telegram_user_id: USERS.author, entity_id: `application:${applicationId(1)}` },
			]);
			expect(await boundary.query("SELECT id, idempotency_key, status FROM outbox_deliveries")).toEqual([
				{ id: deliveryId(1), idempotency_key: "legacy.decision.dm", status: "prepared" },
			]);
			expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);

			await expect(boundary.execute(
				"UPDATE applications SET status = 'accepted', decided_by_profile_id = ?, decided_at = ? WHERE id = ?",
				[PROFILES.first, NOW, applicationId(1)],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"UPDATE collaborations SET status = 'matched' WHERE id = ?",
				[CARDS.twoSlots],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"UPDATE collaborations SET matched_at = NULL WHERE id = ?",
				[CARDS.lastSlot],
			)).rejects.toThrow(/immutable|matched/i);

			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await expect(upgraded.migrate(boundary)).resolves.toMatchObject({ noOp: true });
			expect(await boundary.query("SELECT id, status, matched_at FROM collaborations ORDER BY id")).toEqual([
				{ id: CARDS.twoSlots, status: "published", matched_at: null },
				{ id: CARDS.lastSlot, status: "matched", matched_at: NOW - 100 },
			]);
			expect(await boundary.query("SELECT id, status FROM applications")).toEqual([{ id: applicationId(1), status: "pending" }]);
			expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("S3-04 serialized application decisions", () => {
	it("accepts once under durable replay and atomically creates pair DMs plus one showcase projection", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(10), CARDS.twoSlots, PROFILES.first, "Первый кандидат предлагает городской видеопроект.");
			const durable = createDurableExecutor(fixture);
			const execute = () => durable.execute({
				context: telegramContext(1001, USERS.author),
				input: { kind: "callback_query", data: "cb_synthetic_accept_1" },
				effect: async () => {
					const result = await fixture.service.decide({
						telegramUserId: USERS.author,
						applicationId: applicationId(10),
						decision: "accept",
						occurredAt: NOW,
					});
					if (!result.ok) return { version: 1, outcome: "conflict" } as const;
					return { version: 1, outcome: "completed", messageKey: "command_completed", entityId: result.applicationId } as const;
				},
			});

			expect(await execute()).toMatchObject({ outcome: "completed", entityId: applicationId(10) });
			expect(await execute()).toMatchObject({ outcome: "completed", entityId: applicationId(10) });
			expect(await fixture.boundary.query("SELECT status, decided_by_profile_id, decided_at FROM applications WHERE id = ?", [applicationId(10)])).toEqual([
				{ status: "accepted", decided_by_profile_id: PROFILES.author, decided_at: NOW },
			]);
			expect(await fixture.boundary.query("SELECT status, projection_revision, matched_at FROM collaborations WHERE id = ?", [CARDS.twoSlots])).toEqual([
				{ status: "published", projection_revision: 1, matched_at: null },
			]);
			const deliveries = await decisionDeliveries(fixture.boundary, CARDS.twoSlots);
			expect(deliveries.map((row) => row.kind).sort()).toEqual(["channel_edit", "dm_send", "dm_send"]);
			expect(new Set(deliveries.map((row) => row.idempotency_key)).size).toBe(3);
			expect(deliveries.some((row) => row.idempotency_key === `channel:${CARDS.twoSlots}:projection:1`)).toBe(true);
			for (const delivery of deliveries) expect(delivery.payload_json).not.toContain("callback_data");
			const authorDm = deliveries.find((row) => row.kind === "dm_send" && row.recipient_chat_id === USERS.author);
			const applicantDm = deliveries.find((row) => row.kind === "dm_send" && row.recipient_chat_id === USERS.first);
			expect(authorDm?.payload_json).toContain("https://t.me/candidate_one");
			expect(applicantDm?.payload_json).toContain(`tg://user?id=${USERS.author}`);
			expect(JSON.stringify(deliveries.filter((row) => row.kind === "dm_send"))).not.toContain("candidate_two");
			expect(await count(fixture.boundary, "command_receipts", "command_id = 'telegram:update:1001'")).toBe(1);
			expect(await count(fixture.boundary, "processed_updates", "update_id = 1001")).toBe(1);
		});
	});

	it("last-slot accept notifies every accepted pair and supersedes an older retryable projection", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(11), CARDS.twoSlots, PROFILES.first, "Первый кандидат принят до заполнения последнего места.");
			await insertApplication(fixture.boundary, applicationId(12), CARDS.twoSlots, PROFILES.second, "Второй кандидат заполняет последнее свободное место.");

			expect(await fixture.service.decide({
				telegramUserId: USERS.author,
				applicationId: applicationId(11),
				decision: "accept",
				occurredAt: NOW,
			})).toMatchObject({ ok: true, collaborationStatus: "published", projectionRevision: 1 });
			const outbox = new SqliteOutboxDeliveryRepository(fixture.boundary);
			const oldProjection = await outbox.claimDue(NOW, "older-projection", NOW + 10_000, ["channel_edit"]);
			if (oldProjection === undefined) throw new Error("first accept must create a projection edit");
			expect(await outbox.markRetryable(oldProjection.id, "older-projection", NOW + 1, NOW + 2, "network", null)).toBe(true);

			expect(await fixture.service.decide({
				telegramUserId: USERS.author,
				applicationId: applicationId(12),
				decision: "accept",
				occurredAt: NOW + 3,
			})).toMatchObject({
				ok: true,
				collaborationStatus: "matched",
				acceptedCount: 2,
				projectionRevision: 2,
			});

			expect(await projectionDeliveries(fixture.boundary, CARDS.twoSlots)).toEqual([
				{ idempotency_key: `channel:${CARDS.twoSlots}:projection:1`, status: "superseded", attempt_count: 1 },
				{ idempotency_key: `channel:${CARDS.twoSlots}:projection:2`, status: "prepared", attempt_count: 0 },
			]);
			const keys = (await decisionDeliveries(fixture.boundary, CARDS.twoSlots)).map((row) => row.idempotency_key);
			expect(keys).toEqual(expect.arrayContaining([
				`collaboration:${CARDS.twoSlots}:matched:author:${applicationId(11)}:v1`,
				`collaboration:${CARDS.twoSlots}:matched:applicant:${applicationId(11)}:v1`,
				`collaboration:${CARDS.twoSlots}:matched:author:${applicationId(12)}:v1`,
				`collaboration:${CARDS.twoSlots}:matched:applicant:${applicationId(12)}:v1`,
			]));
		});
	});

	it("rolls an older projection supersede back when the replacement intent cannot be inserted", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(13), CARDS.twoSlots, PROFILES.first, "Первый кандидат создаёт старую prepared projection.");
			await insertApplication(fixture.boundary, applicationId(14), CARDS.twoSlots, PROFILES.second, "Второй кандидат запускает replacement projection.");
			expect(await fixture.service.decide({
				telegramUserId: USERS.author,
				applicationId: applicationId(13),
				decision: "accept",
				occurredAt: NOW,
			})).toMatchObject({ ok: true, projectionRevision: 1 });

			const realOutbox = new SqliteOutboxDeliveryRepository(fixture.boundary);
			const failingOutbox = new Proxy(realOutbox, {
				get(target, property, receiver) {
					if (property === "insert") return async (record: Parameters<OutboxDeliveryStore["insert"]>[0]): Promise<void> => {
						if (record.idempotencyKey === `channel:${CARDS.twoSlots}:projection:2`) {
							throw new Error("synthetic replacement projection failure");
						}
						await target.insert(record);
					};
					const value: unknown = Reflect.get(target, property, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
			}) as OutboxDeliveryStore;

			await expect(createApplicationService(fixture.boundary, fixture.clock, failingOutbox).decide({
				telegramUserId: USERS.author,
				applicationId: applicationId(14),
				decision: "accept",
				occurredAt: NOW + 1,
			})).rejects.toThrow("synthetic replacement projection failure");

			expect(await projectionDeliveries(fixture.boundary, CARDS.twoSlots)).toEqual([
				{ idempotency_key: `channel:${CARDS.twoSlots}:projection:1`, status: "prepared", attempt_count: 0 },
			]);
			expect(await fixture.boundary.query("SELECT id, status FROM applications WHERE collaboration_id = ? ORDER BY id", [CARDS.twoSlots])).toEqual([
				{ id: applicationId(13), status: "accepted" },
				{ id: applicationId(14), status: "pending" },
			]);
			expect(await fixture.boundary.query("SELECT status, projection_revision, matched_at FROM collaborations WHERE id = ?", [CARDS.twoSlots])).toEqual([
				{ status: "published", projection_revision: 1, matched_at: null },
			]);
		});
	});

	it("supersedes an older retry that finishes after the replacement revision was committed", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(15), CARDS.twoSlots, PROFILES.first, "Первый кандидат создаёт in-flight projection.");
			await insertApplication(fixture.boundary, applicationId(16), CARDS.twoSlots, PROFILES.second, "Второй кандидат создаёт новую revision во время dispatch.");
			expect(await fixture.service.decide({
				telegramUserId: USERS.author,
				applicationId: applicationId(15),
				decision: "accept",
				occurredAt: NOW,
			})).toMatchObject({ ok: true, projectionRevision: 1 });

			const outbox = new SqliteOutboxDeliveryRepository(fixture.boundary);
			const inFlight = await outbox.claimDue(NOW, "in-flight-projection", NOW + 10_000, ["channel_edit"]);
			if (inFlight === undefined) throw new Error("first projection edit must be claimable");
			expect(await fixture.service.decide({
				telegramUserId: USERS.author,
				applicationId: applicationId(16),
				decision: "accept",
				occurredAt: NOW + 1,
			})).toMatchObject({ ok: true, collaborationStatus: "matched", projectionRevision: 2 });
			expect(await outbox.markRetryable(inFlight.id, "in-flight-projection", NOW + 2, NOW + 1_002, "network", null)).toBe(true);

			expect(await new SqliteCollaborationBrowseRepository(fixture.boundary).supersedeStaleProjectionDeliveries(NOW + 3)).toBe(1);
			expect(await projectionDeliveries(fixture.boundary, CARDS.twoSlots)).toEqual([
				{ idempotency_key: `channel:${CARDS.twoSlots}:projection:1`, status: "superseded", attempt_count: 1 },
				{ idempotency_key: `channel:${CARDS.twoSlots}:projection:2`, status: "prepared", attempt_count: 0 },
			]);
		});
	});

	it("serializes two accepts for the last slot without exceeding capacity", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(20), CARDS.lastSlot, PROFILES.first, "Первый конкурент за единственное свободное место.");
			await insertApplication(fixture.boundary, applicationId(21), CARDS.lastSlot, PROFILES.second, "Второй конкурент за единственное свободное место.");

			const results = await Promise.all([
				fixture.service.decide({ telegramUserId: USERS.author, applicationId: applicationId(20), decision: "accept", occurredAt: NOW }),
				fixture.service.decide({ telegramUserId: USERS.author, applicationId: applicationId(21), decision: "accept", occurredAt: NOW }),
			]);
			expect(results.filter((result) => result.ok)).toHaveLength(1);
			expect(results.filter((result) => !result.ok)).toHaveLength(1);
			expect(await fixture.boundary.query("SELECT status, count(*) AS count FROM applications WHERE collaboration_id = ? GROUP BY status ORDER BY status", [CARDS.lastSlot])).toEqual([
				{ status: "accepted", count: 1 },
				{ status: "closed", count: 1 },
			]);
			expect(await fixture.boundary.query("SELECT status, projection_revision, matched_at FROM collaborations WHERE id = ?", [CARDS.lastSlot])).toEqual([
				{ status: "matched", projection_revision: 1, matched_at: NOW },
			]);
			expect(await count(fixture.boundary, "outbox_deliveries")).toBeGreaterThanOrEqual(4);
			expect(await count(fixture.boundary, "outbox_deliveries", "idempotency_key = ?", [`channel:${CARDS.lastSlot}:projection:1`])).toBe(1);
		});
	});

	it("rejects only the selected pending application and leaves public capacity unchanged", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(30), CARDS.reject, PROFILES.first, "Этот отклик автор решил отклонить отдельно.");
			await insertApplication(fixture.boundary, applicationId(31), CARDS.reject, PROFILES.second, "Этот соседний отклик должен остаться pending.");

			const result = await fixture.service.decide({
				telegramUserId: USERS.author,
				applicationId: applicationId(30),
				decision: "reject",
				occurredAt: NOW,
			});
			expect(result).toMatchObject({
				ok: true,
				applicationId: applicationId(30),
				applicationStatus: "rejected",
				collaborationStatus: "published",
				acceptedCount: 0,
				projectionRevision: 0,
			});
			expect(await fixture.boundary.query("SELECT id, status FROM applications WHERE collaboration_id = ? ORDER BY id", [CARDS.reject])).toEqual([
				{ id: applicationId(30), status: "rejected" },
				{ id: applicationId(31), status: "pending" },
			]);
			expect(await fixture.boundary.query("SELECT status, projection_revision, matched_at FROM collaborations WHERE id = ?", [CARDS.reject])).toEqual([
				{ status: "published", projection_revision: 0, matched_at: null },
			]);
			const deliveries = await decisionDeliveries(fixture.boundary, CARDS.reject);
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0]).toMatchObject({ kind: "dm_send", recipient_chat_id: USERS.first });
			expect(deliveries[0]?.payload_json).not.toContain("tg://user?id=");
			expect(deliveries[0]?.payload_json).not.toContain("https://t.me/candidate_one");
		});
	});

	it("manually closes only after an accepted application and closes every remaining pending application", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(40), CARDS.manualClose, PROFILES.first, "Принятый кандидат до ручного завершения набора.");
			await insertApplication(fixture.boundary, applicationId(41), CARDS.manualClose, PROFILES.second, "Ожидающий кандидат будет закрыт вместе с набором.");

			expect(await fixture.service.completeRecruitment({
				telegramUserId: USERS.author,
				collaborationId: CARDS.manualClose,
				occurredAt: NOW,
			})).toEqual({ ok: false, code: "no_accepted" });
			expect(await fixture.service.decide({ telegramUserId: USERS.author, applicationId: applicationId(40), decision: "accept", occurredAt: NOW })).toMatchObject({ ok: true });
			const deliveriesBeforeClose = await count(fixture.boundary, "outbox_deliveries");
			expect(await fixture.service.completeRecruitment({
				telegramUserId: USERS.author,
				collaborationId: CARDS.manualClose,
				occurredAt: NOW + 1,
			})).toMatchObject({
				ok: true,
				collaborationId: CARDS.manualClose,
				collaborationStatus: "matched",
				acceptedCount: 1,
				projectionRevision: 2,
			});
			expect(await fixture.boundary.query("SELECT id, status FROM applications WHERE collaboration_id = ? ORDER BY id", [CARDS.manualClose])).toEqual([
				{ id: applicationId(40), status: "accepted" },
				{ id: applicationId(41), status: "closed" },
			]);
			expect(await fixture.boundary.query("SELECT status, projection_revision, matched_at FROM collaborations WHERE id = ?", [CARDS.manualClose])).toEqual([
				{ status: "matched", projection_revision: 2, matched_at: NOW + 1 },
			]);
			expect((await count(fixture.boundary, "outbox_deliveries")) - deliveriesBeforeClose).toBeGreaterThanOrEqual(4);
			expect(await projectionDeliveries(fixture.boundary, CARDS.manualClose)).toEqual([
				{ idempotency_key: `channel:${CARDS.manualClose}:projection:1`, status: "superseded", attempt_count: 0 },
				{ idempotency_key: `channel:${CARDS.manualClose}:projection:2`, status: "prepared", attempt_count: 0 },
			]);
		});
	});

	it("rolls back the decision, projection, durable receipt, and every intent when outbox insertion fails", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(50), CARDS.privacy, PROFILES.first, "Этот accept должен полностью откатиться вместе с outbox.");
			const realOutbox = new SqliteOutboxDeliveryRepository(fixture.boundary);
			const failingOutbox = new Proxy(realOutbox, {
				get(target, property, receiver) {
					if (property === "insert") return async (): Promise<void> => { throw new Error("synthetic decision outbox failure"); };
					const value: unknown = Reflect.get(target, property, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
			}) as OutboxDeliveryStore;
			const service = createApplicationService(fixture.boundary, fixture.clock, failingOutbox);
			const durable = createDurableExecutor(fixture);

			await expect(durable.execute({
				context: telegramContext(1050, USERS.author),
				input: { kind: "callback_query", data: "cb_synthetic_rollback" },
				effect: async () => {
					await service.decide({ telegramUserId: USERS.author, applicationId: applicationId(50), decision: "accept", occurredAt: NOW });
					return { version: 1, outcome: "completed", messageKey: "command_completed" };
				},
			})).rejects.toThrow("synthetic decision outbox failure");
			expect(await fixture.boundary.query("SELECT status, decided_by_profile_id, decided_at FROM applications WHERE id = ?", [applicationId(50)])).toEqual([
				{ status: "pending", decided_by_profile_id: null, decided_at: null },
			]);
			expect(await fixture.boundary.query("SELECT status, projection_revision, matched_at FROM collaborations WHERE id = ?", [CARDS.privacy])).toEqual([
				{ status: "published", projection_revision: 0, matched_at: null },
			]);
			expect(await count(fixture.boundary, "outbox_deliveries")).toBe(0);
			expect(await count(fixture.boundary, "command_receipts", "command_id = 'telegram:update:1050'")).toBe(0);
			expect(await count(fixture.boundary, "processed_updates", "update_id = 1050")).toBe(0);
		});
	});
});

describe("S3-04 authoritative views and pair-contact privacy", () => {
	it("recomputes current counterpart actions only for the exact accepted pair and keeps multi-slot candidates isolated", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(60), CARDS.privacy, PROFILES.first, "Первый accepted кандидат в multi-slot карточке.");
			await insertApplication(fixture.boundary, applicationId(61), CARDS.privacy, PROFILES.second, "Второй accepted кандидат в multi-slot карточке.");
			await insertApplication(fixture.boundary, applicationId(62), CARDS.privacy, PROFILES.third, "Pending кандидат не должен получить contact action.");

			expect(await fixture.service.getPairContact(USERS.author, applicationId(60))).toEqual({ ok: false, code: "not_accepted" });
			expect(await fixture.service.decide({ telegramUserId: USERS.author, applicationId: applicationId(60), decision: "accept", occurredAt: NOW })).toMatchObject({ ok: true });
			expect(await fixture.service.decide({ telegramUserId: USERS.author, applicationId: applicationId(61), decision: "accept", occurredAt: NOW + 1 })).toMatchObject({ ok: true });

			expect(await fixture.service.getPairContact(USERS.author, applicationId(60))).toEqual({ ok: true, url: "https://t.me/candidate_one" });
			expect(await fixture.service.getPairContact(USERS.first, applicationId(60))).toEqual({ ok: true, url: `tg://user?id=${USERS.author}` });
			expect(await fixture.service.getPairContact(USERS.outsider, applicationId(60))).toEqual({ ok: false, code: "not_pair" });
			expect(await fixture.service.getPairContact(USERS.first, applicationId(61))).toEqual({ ok: false, code: "not_pair" });
			expect(await fixture.service.getPairContact(USERS.third, applicationId(62))).toEqual({ ok: false, code: "not_accepted" });

			await fixture.boundary.execute("UPDATE telegram_users SET username = 'candidate_one_new', updated_at = ? WHERE telegram_user_id = ?", [NOW + 2, USERS.first]);
			expect(await fixture.service.getPairContact(USERS.author, applicationId(60))).toEqual({ ok: true, url: "https://t.me/candidate_one_new" });
			await fixture.boundary.execute("UPDATE telegram_users SET username = NULL, updated_at = ? WHERE telegram_user_id = ?", [NOW + 3, USERS.first]);
			expect(await fixture.service.getPairContact(USERS.author, applicationId(60))).toEqual({ ok: true, url: `tg://user?id=${USERS.first}` });
		});
	});

	it("keeps persisted own/author statuses authoritative after ambiguous DM and failed showcase delivery", async () => {
		await withDecisionDatabase(async (fixture) => {
			await insertApplication(fixture.boundary, applicationId(70), CARDS.twoSlots, PROFILES.first, "Authoritative status survives delivery outcomes.");
			expect(await fixture.service.decide({ telegramUserId: USERS.author, applicationId: applicationId(70), decision: "accept", occurredAt: NOW })).toMatchObject({ ok: true });

			const store = new SqliteOutboxDeliveryRepository(fixture.boundary);
			const dm = await store.claimDue(NOW, "decision-dm-claim", NOW + 10_000, ["dm_send"]);
			if (dm === undefined) throw new Error("accepted decision must create a DM");
			expect(await store.markAmbiguous(dm.id, "decision-dm-claim", NOW + 1, "network")).toBe(true);
			const edit = await store.claimDue(NOW + 1, "decision-edit-claim", NOW + 10_001, ["channel_edit"]);
			if (edit === undefined) throw new Error("accepted decision must create a showcase edit");
			expect(await store.markPermanent(edit.id, "decision-edit-claim", NOW + 2, "forbidden")).toBe(true);

			expect(await fixture.service.listOwnApplications(USERS.first)).toEqual(expect.arrayContaining([
				expect.objectContaining({
					applicationId: applicationId(70),
					collaborationId: CARDS.twoSlots,
					status: "accepted",
				}),
			]));
			const management = await fixture.service.getAuthorManagement(USERS.author, CARDS.twoSlots);
			expect(management).toMatchObject({
				collaborationId: CARDS.twoSlots,
				status: "published",
				acceptedCount: 1,
				slotsTotal: 2,
				applications: expect.arrayContaining([
					expect.objectContaining({ applicationId: applicationId(70), status: "accepted" }),
				]),
			});
			expect(JSON.stringify(management)).not.toContain("candidate_two");
			expect(await fixture.boundary.query("SELECT id, status FROM applications WHERE id = ?", [applicationId(70)])).toEqual([
				{ id: applicationId(70), status: "accepted" },
			]);
			expect(await fixture.boundary.query("SELECT status, projection_revision FROM collaborations WHERE id = ?", [CARDS.twoSlots])).toEqual([
				{ status: "published", projection_revision: 1 },
			]);
		});
	});
});

interface DecisionFixture {
	readonly boundary: DatabaseBoundary;
	readonly clock: FakeClock;
	readonly service: ApplicationService;
}

async function withDecisionDatabase(work: (fixture: DecisionFixture) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-04-service-"));
	const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
	const clock = new FakeClock(NOW);
	try {
		expect((await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		await seedDecisionFixture(boundary);
		await work({ boundary, clock, service: createApplicationService(boundary, clock) });
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

function createApplicationService(
	boundary: DatabaseBoundary,
	clock: FakeClock,
	outbox: OutboxDeliveryStore = new SqliteOutboxDeliveryRepository(boundary),
): ApplicationService {
	return new ApplicationService(
		new SqliteCollaborationBrowseRepository(boundary),
		outbox,
		new DatabaseBoundaryTransactionRunner(boundary),
		clock,
		BOT_USERNAME,
	);
}

function createDurableExecutor(fixture: Pick<DecisionFixture, "boundary" | "clock">): DurableCommandExecutor {
	return new DurableCommandExecutor(
		new DatabaseBoundaryTransactionRunner(fixture.boundary),
		new SqliteDurableCommandStore(fixture.boundary),
		{ hash: hashCanonicalInput },
		fixture.clock,
	);
}

function telegramContext(updateId: number, telegramUserId: string) {
	return {
		commandId: `telegram:update:${updateId}`,
		telegramUpdateId: updateId,
		actor: { kind: "telegram_user" as const, telegramUserId },
		occurredAt: new Date(NOW),
	};
}

async function seedDecisionFixture(boundary: DatabaseBoundary): Promise<void> {
	await seedUser(boundary, USERS.author, null);
	await seedProfile(boundary, USERS.author, PROFILES.author, "Public author");
	await seedUser(boundary, USERS.first, "candidate_one");
	await seedProfile(boundary, USERS.first, PROFILES.first, "Public candidate one");
	await seedUser(boundary, USERS.second, "candidate_two");
	await seedProfile(boundary, USERS.second, PROFILES.second, "Public candidate two");
	await seedUser(boundary, USERS.third, null);
	await seedProfile(boundary, USERS.third, PROFILES.third, "Public candidate three");
	await seedUser(boundary, USERS.outsider, "outsider_private");
	await seedProfile(boundary, USERS.outsider, PROFILES.outsider, "Public outsider");

	await insertCard(boundary, { id: CARDS.twoSlots, token: TOKENS.twoSlots, authorProfileId: PROFILES.author, slotsTotal: 2 });
	await insertCard(boundary, { id: CARDS.lastSlot, token: TOKENS.lastSlot, authorProfileId: PROFILES.author, slotsTotal: 1 });
	await insertCard(boundary, { id: CARDS.manualClose, token: TOKENS.manualClose, authorProfileId: PROFILES.author, slotsTotal: 2 });
	await insertCard(boundary, { id: CARDS.reject, token: TOKENS.reject, authorProfileId: PROFILES.author, slotsTotal: 2 });
	await insertCard(boundary, { id: CARDS.privacy, token: TOKENS.privacy, authorProfileId: PROFILES.author, slotsTotal: 3 });
}

async function seedUser(boundary: DatabaseBoundary, telegramUserId: string, username: string | null): Promise<void> {
	await boundary.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
		[telegramUserId, username, `User ${telegramUserId}`, NOW - DAY, NOW - DAY],
	);
}

async function seedProfile(boundary: DatabaseBoundary, telegramUserId: string, id: string, displayName: string): Promise<void> {
	const ordinal = Number.parseInt(id.slice(0, 8), 16);
	await boundary.execute(
		"INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, 'blogger', ?, 'ekaterinburg', 'active', ?, ?, NULL)",
		[id, telegramUserId, displayName, NOW - DAY, NOW - DAY],
	);
	await boundary.execute(
		"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, 'website', ?, NULL, NULL, NULL, NULL)",
		[platformId(ordinal), id, `https://example.com/${ordinal}`],
	);
}

interface InsertCardOptions {
	readonly id: string;
	readonly token: string;
	readonly authorProfileId: string;
	readonly slotsTotal: number;
	readonly status?: "published" | "matched";
	readonly updatedAt?: number;
}

async function insertCard(boundary: DatabaseBoundary, options: InsertCardOptions): Promise<void> {
	const updatedAt = options.updatedAt ?? NOW - DAY;
	await boundary.execute(
		"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at, published_at) VALUES (?, ?, ?, 'joint_content', 'blogger', ?, 'Совместный материал для аудитории города.', 'Нужен партнёр для съёмки и согласования.', ?, ?, NULL, 'ekaterinburg', ?, 1, 0, ?, ?, ?)",
		[
			options.id,
			options.token,
			options.authorProfileId,
			`Card ${options.id.slice(0, 8)}`,
			options.slotsTotal,
			NOW + DAY,
			options.status ?? "published",
			NOW - DAY,
			updatedAt,
			NOW - DAY,
		],
	);
	await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, 'city')", [options.id]);
	await boundary.execute(
		"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', ?, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
		[options.id, 700 + Number.parseInt(options.id.slice(0, 8), 16), options.id.replaceAll("-", "").padEnd(64, "0").slice(0, 64), updatedAt],
	);
}

async function insertApplication(
	boundary: DatabaseBoundary,
	id: string,
	collaborationId: string,
	applicantProfileId: string,
	message: string,
): Promise<void> {
	await boundary.execute(
		"INSERT INTO applications (id, collaboration_id, applicant_profile_id, message, terms_version, collaboration_version, status, decided_by_profile_id, decided_at, created_at) VALUES (?, ?, ?, ?, 1, 1, 'pending', NULL, NULL, ?)",
		[id, collaborationId, applicantProfileId, message, NOW - 100],
	);
}

interface DecisionDeliveryRow {
	readonly id: string;
	readonly idempotency_key: string;
	readonly kind: string;
	readonly recipient_chat_id: string;
	readonly payload_json: string;
}

interface ProjectionDeliveryRow {
	readonly idempotency_key: string;
	readonly status: string;
	readonly attempt_count: number;
}

async function decisionDeliveries(boundary: DatabaseBoundary, collaborationId: string): Promise<readonly DecisionDeliveryRow[]> {
	return boundary.query<DecisionDeliveryRow>(
		"SELECT id, idempotency_key, kind, recipient_chat_id, payload_json FROM outbox_deliveries WHERE kind = 'dm_send' OR idempotency_key LIKE ? ORDER BY kind, recipient_chat_id, id",
		[`channel:${collaborationId}:projection:%`],
	);
}

async function projectionDeliveries(boundary: DatabaseBoundary, collaborationId: string): Promise<readonly ProjectionDeliveryRow[]> {
	return boundary.query<ProjectionDeliveryRow>(
		"SELECT idempotency_key, status, attempt_count FROM outbox_deliveries WHERE kind = 'channel_edit' AND idempotency_key LIKE ? ORDER BY idempotency_key",
		[`channel:${collaborationId}:projection:%`],
	);
}

async function count(
	boundary: DatabaseBoundary,
	table: "applications" | "outbox_deliveries" | "command_receipts" | "processed_updates",
	where?: string,
	parameters: readonly (string | number)[] = [],
): Promise<number> {
	const rows = await boundary.query<{ count: number }>(
		`SELECT count(*) AS count FROM ${table}${where === undefined ? "" : ` WHERE ${where}`}`,
		parameters,
	);
	return rows[0]?.count ?? -1;
}

function migrationNamesThrough0010(): readonly string[] {
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
	];
}

function profileId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`; }
function platformId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000002`; }
function cardId(prefix: string): string { return `${prefix.padStart(8, prefix)}-0000-4000-8000-000000000003`; }
function applicationId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000004`; }
function deliveryId(value: number): string { return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000005`; }
