import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	AtomicCompanionService,
	OutboxDeliveryService,
	OutboxIdempotencyConflictError,
	OutboxTransitionError,
} from "../../src/application/outbox/outbox-service.js";
import {
	createSafeAttributes,
	ProductEventIdConflictError,
	ProductEventIdempotencyConflictError,
	ProductEventService,
} from "../../src/application/outbox/product-event-service.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { outboxDeliveries, productEvents } from "../../src/infrastructure/database/drizzle-schema.js";
import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { SqliteProductEventRepository } from "../../src/infrastructure/database/product-event-repository.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";

const canonicalMigrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

async function withDatabase<T>(work: (boundary: DatabaseBoundary, clock: FakeClock) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s0-05-outbox-"));
	const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
	const clock = new FakeClock(10 * DAY_MS);
	try {
		const source = await MigrationSource.fromDirectory(canonicalMigrationsPath);
		const runner = new MigrationRunner(source, clock);
		expect((await runner.migrate(boundary)).applied).toEqual([1, 2]);
		expect((await runner.migrate(boundary)).applied).toEqual([]);
		await runner.verify(boundary);
		return await work(boundary, clock);
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

function createServices(boundary: DatabaseBoundary, clock: FakeClock): {
	outbox: OutboxDeliveryService;
	events: ProductEventService;
	companions: AtomicCompanionService;
} {
	const transactionRunner = new DatabaseBoundaryTransactionRunner(boundary);
	const outbox = new OutboxDeliveryService(
		new SqliteOutboxDeliveryRepository(boundary),
		transactionRunner,
		clock,
	);
	const events = new ProductEventService(
		new SqliteProductEventRepository(boundary),
		transactionRunner,
		clock,
	);
	return {
		outbox,
		events,
		companions: new AtomicCompanionService(transactionRunner, outbox, events),
	};
}

const sendPayload = {
	version: 1 as const,
	method: "send" as const,
	text: "synthetic delivery",
};

describe("S0-05 canonical schema and migrations", () => {
	it("applies 0002 after 0001, repeats safely, and keeps only foundation tables", async () => {
		await withDatabase(async (boundary) => {
			const tables = await boundary.query<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			);
			expect(tables.map((table) => table.name)).toEqual([
				"__app_migrations",
				"command_receipts",
				"outbox_deliveries",
				"processed_updates",
				"product_events",
				"telegram_actions",
				"telegram_users",
			]);
			expect(await boundary.query<{ foreign_keys: number }>("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
			expect(outboxDeliveries.idempotencyKey.name).toBe("idempotency_key");
			expect(outboxDeliveries.requestDeadlineAt.name).toBe("request_deadline_at");
			expect(productEvents.eventType.name).toBe("event_type");
			expect(productEvents.safeAttributesJson.name).toBe("safe_attributes_json");
			expect(await boundary.query<{ name: string }>("SELECT name FROM sqlite_master WHERE name IN ('operator_actions', 'profiles', 'collaborations')")).toEqual([]);
		});
	});

	it("enforces outbox/event columns, SQL coherence, unique keys, and safe indexes", async () => {
		await withDatabase(async (boundary) => {
			expect((await boundary.query<{ name: string }>("PRAGMA table_info(outbox_deliveries)")).map((column) => column.name)).toEqual([
				"id", "idempotency_key", "kind", "recipient_chat_id", "message_id", "payload_json", "status", "attempt_count",
				"claim_token", "dispatch_started_at", "request_deadline_at", "next_attempt_at", "telegram_retry_after",
				"last_error_kind", "created_at", "updated_at",
			]);
			expect((await boundary.query<{ name: string }>("PRAGMA table_info(product_events)")).map((column) => column.name)).toEqual([
				"event_id", "event_type", "idempotency_key", "actor_telegram_user_id", "profile_id", "collaboration_id",
				"application_id", "safe_attributes_json", "occurred_at",
			]);
			expect((await boundary.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('outbox_deliveries_due', 'outbox_deliveries_dispatching', 'outbox_deliveries_recipient', 'product_events_type_occurred', 'product_events_actor_occurred') ORDER BY name")).map((row) => row.name)).toEqual([
				"outbox_deliveries_dispatching", "outbox_deliveries_due", "outbox_deliveries_recipient", "product_events_actor_occurred", "product_events_type_occurred",
			]);
			const insertOutbox = "INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
			const base = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "sql.delivery.1", "dm_send", "-100123", null, '{"version":1,"method":"send","text":"x"}', "prepared", 0, null, null, null, null, null, null, 0, 0];
			await boundary.execute(insertOutbox, base);
			await boundary.execute(insertOutbox, ["abababab-abab-4aba-8aba-abababababab", "sql.delivery.scheduled", "dm_send", "123", null, '{"version":1,"method":"send","text":"x"}', "prepared", 0, null, null, null, 1_000, null, null, 0, 0]);
			await expect(boundary.execute(insertOutbox, ["bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", "sql.delivery.past-schedule", "dm_send", "123", null, '{"version":1,"method":"send","text":"x"}', "prepared", 0, null, null, null, 999, null, null, 1_000, 1_000])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ...base.slice(1)])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "sql.delivery.bad-recipient", "dm_send", "-", null, '{"version":1,"method":"send","text":"x"}', "prepared", 0, null, null, null, null, null, null, 0, 0])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "sql.delivery.bad-state", "dm_send", "123", null, '{"version":1,"method":"send","text":"x"}', "dispatching", 1, null, null, null, null, null, null, 0, 0])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["12121212-1212-4121-8121-121212121212", "sql.delivery.sent-zero", "channel_edit", "123", 42, '{"version":1,"method":"edit","text":"x"}', "sent", 0, null, null, null, null, null, null, 0, 0])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["13131313-1313-4131-8131-131313131313", "sql.delivery.sent-retry", "channel_edit", "123", 42, '{"version":1,"method":"edit","text":"x"}', "sent", 1, null, null, null, 5, null, null, 0, 0])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["14141414-1414-4141-8141-141414141414", "sql.delivery.permanent-no-error", "dm_send", "123", null, '{"version":1,"method":"send","text":"x"}', "permanent_failed", 1, null, null, null, null, null, null, 0, 0])).rejects.toThrow();
			await boundary.execute(insertOutbox, ["15151515-1515-4151-8151-151515151515", "sql.delivery.permanent-valid", "dm_send", "123", null, '{"version":1,"method":"send","text":"x"}', "permanent_failed", 1, null, null, null, null, null, "forbidden", 0, 0]);
			await expect(boundary.execute(insertOutbox, ["16161616-1616-4161-8161-161616161616", "sql.delivery.ambiguous-retry-after", "dm_send", "123", null, '{"version":1,"method":"send","text":"x"}', "ambiguous", 1, null, null, null, null, 5, "network", 0, 0])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa-", "sql.delivery.extra-hyphen", "dm_send", "123", null, '{"version":1,"method":"send","text":"x"}', "prepared", 0, null, null, null, null, null, null, 0, 0])).rejects.toThrow();
			await expect(boundary.execute(insertOutbox, ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "sql.delivery.bad-edit", "channel_edit", "123", null, '{"version":1,"method":"edit","text":"x"}', "prepared", 0, null, null, null, null, null, null, 0, 0])).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO product_events (event_id, event_type, idempotency_key, actor_telegram_user_id, profile_id, collaboration_id, application_id, safe_attributes_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["ffffffff-ffff-4fff-8fff-ffffffffffff", "not_an_event", "sql.event.1", null, null, null, null, "{}", 0],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO product_events (event_id, event_type, idempotency_key, actor_telegram_user_id, profile_id, collaboration_id, application_id, safe_attributes_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["abababab-abab-4aba-8aba-abababababab", "bot_started", "sql.event.2", null, null, null, null, "[]", 0],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO product_events (event_id, event_type, idempotency_key, actor_telegram_user_id, profile_id, collaboration_id, application_id, safe_attributes_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa-", "bot_started", "sql.event.bad-uuid", null, null, null, null, "{}", 0],
			)).rejects.toThrow();
			await boundary.execute(
				"INSERT INTO product_events (event_id, event_type, idempotency_key, actor_telegram_user_id, profile_id, collaboration_id, application_id, safe_attributes_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["12121212-1212-4121-8121-121212121212", "bot_started", "sql.event.append-only", null, null, null, null, "{}", 0],
			);
			await expect(boundary.execute("UPDATE product_events SET occurred_at = 1 WHERE event_id = ?", ["12121212-1212-4121-8121-121212121212"])).rejects.toThrow();
			await expect(boundary.execute("DELETE FROM product_events WHERE event_id = ?", ["12121212-1212-4121-8121-121212121212"])).rejects.toThrow();
		});
	});

	it("upgrades a 0001 fixture with immutable 0002 and verifies integrity", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s0-05-upgrade-"));
		const migrationsPath = join(directory, "migrations");
		await mkdir(migrationsPath);
		await copyFile(
			join(canonicalMigrationsPath, "0001_s0-04-ingress-foundation.sql"),
			join(migrationsPath, "0001_s0-04-ingress-foundation.sql"),
		);
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		try {
			const first = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), new FakeClock(1));
			expect((await first.migrate(boundary)).applied).toEqual([1]);
			await copyFile(
				join(canonicalMigrationsPath, "0002_s0-05-outbox-events.sql"),
				join(migrationsPath, "0002_s0-05-outbox-events.sql"),
			);
			const upgraded = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), new FakeClock(2));
			expect((await upgraded.migrate(boundary)).applied).toEqual([2]);
			expect((await upgraded.migrate(boundary)).applied).toEqual([]);
			await upgraded.verify(boundary);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("S0-05 outbox and product-event stores", () => {
	it("accepts scheduled prepared delivery and replays its explicit schedule", async () => {
		await withDatabase(async (_boundary, clock) => {
			const { outbox } = createServices(_boundary, clock);
			const notBeforeAt = clock.now().getTime() + 5_000;
			const request = {
				id: "12121212-1212-4121-8121-121212121212",
				idempotencyKey: "delivery.scheduled.1",
				kind: "dm_send" as const,
				recipientChatId: "123",
				notBeforeAt,
				payload: sendPayload,
			};
			expect(await outbox.create(request)).toMatchObject({ status: "prepared", nextAttemptAt: notBeforeAt });
			clock.advanceBy(6_000);
			expect(await outbox.create({ ...request, id: "13131313-1313-4131-8131-131313131313" })).toMatchObject({ nextAttemptAt: notBeforeAt });
			await expect(outbox.create({ ...request, id: "14141414-1414-4141-8141-141414141414", notBeforeAt: notBeforeAt + 1_000 })).rejects.toBeInstanceOf(OutboxIdempotencyConflictError);
			await expect(outbox.create({ ...request, id: "15151515-1515-4151-8151-151515151515", idempotencyKey: "delivery.scheduled.past", notBeforeAt: clock.now().getTime() - 1 })).rejects.toThrow();
			await outbox.cancel(request.id);
			expect(await outbox.findById(request.id)).toMatchObject({ status: "cancelled", nextAttemptAt: null });
		});
	});

	it("cancelled delivery is prepared-only and validates payloads/idempotency", async () => {
		await withDatabase(async (boundary, clock) => {
			const { outbox } = createServices(boundary, clock);
			const request = {
				id: DELIVERY_ID,
				idempotencyKey: "delivery.semantic.1",
				kind: "dm_send" as const,
				recipientChatId: "123456789",
				payload: sendPayload,
			};
			const created = await outbox.create(request);
			expect(created).toMatchObject({ status: "prepared", attemptCount: 0, messageId: null });
			expect(await outbox.create(request)).toEqual(created);
			clock.advanceBy(500);
			expect(await outbox.create({ ...request, id: "33333333-3333-4333-8333-333333333333" })).toEqual(created);
			await expect(outbox.create({ ...request, recipientChatId: "987654321" })).rejects.toBeInstanceOf(OutboxIdempotencyConflictError);
			await expect(outbox.create({
				...request,
				id: "44444444-4444-4444-8444-444444444444",
				idempotencyKey: "delivery.semantic.invalid-payload",
				payload: { version: 1, method: "delete" },
			})).rejects.toThrow();
			await expect(outbox.create({
				...request,
				id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				idempotencyKey: "delivery.semantic.send-target",
				messageId: 42,
			})).rejects.toThrow();
			await expect(outbox.create({
				...request,
				id: "55555555-5555-4555-8555-555555555555",
				idempotencyKey: "delivery.semantic.to-json",
				payload: { ...sendPayload, toJSON: () => ({ token: "unexpected-value" }) },
			} as never)).rejects.toThrow();
			await expect(outbox.create({
				...request,
				id: "88888888-8888-4888-8888-888888888888",
				idempotencyKey: "delivery.semantic.oversize",
				payload: { ...sendPayload, text: "x".repeat(4_097) },
			})).rejects.toThrow();

			await outbox.cancel(DELIVERY_ID);
			expect((await outbox.findById(DELIVERY_ID))?.status).toBe("cancelled");
			const edit = await outbox.create({
				...request,
				id: "66666666-6666-4666-8666-666666666666",
				idempotencyKey: "delivery.semantic.edit",
				kind: "channel_edit",
				recipientChatId: "-1001234567890",
				messageId: 42,
				payload: { version: 1, method: "edit", text: "synthetic edit" },
			});
			await outbox.cancel(edit.id);
			expect(await outbox.findById(edit.id)).toMatchObject({ status: "cancelled", messageId: 42 });
			const superseded = await outbox.create({
				...request,
				id: "77777777-7777-4777-8777-777777777777",
				idempotencyKey: "delivery.semantic.superseded",
			});
			await outbox.supersede(superseded.id);
			expect((await outbox.findById(superseded.id))?.status).toBe("superseded");
			await expect(outbox.cancel(superseded.id)).rejects.toBeInstanceOf(OutboxTransitionError);
		});
	});

	it("outbox atomicity commits or rolls back business probe with delivery and event companions", async () => {
		await withDatabase(async (boundary, clock) => {
			await boundary.execute("CREATE TABLE business_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
			const { companions } = createServices(boundary, clock);
			const delivery = {
				id: DELIVERY_ID,
				idempotencyKey: "atomic.delivery.1",
				kind: "channel_send" as const,
				recipientChatId: "-1001234567890",
				payload: sendPayload,
			};
			const event = {
				eventId: EVENT_ID,
				idempotencyKey: "atomic.event.1",
				eventType: "bot_started" as const,
				safeAttributes: createSafeAttributes("bot_started", { enabled: true }),
			};
			await companions.run({
				businessEffect: async () => {
					await boundary.execute("INSERT INTO business_probe (label) VALUES (?)", ["committed"]);
				},
				delivery,
				event,
			});
			expect(await boundary.query("SELECT label FROM business_probe")).toEqual([{ label: "committed" }]);
			expect(await boundary.query("SELECT id FROM outbox_deliveries")).toEqual([{ id: DELIVERY_ID }]);
			expect(await boundary.query("SELECT event_id FROM product_events")).toEqual([{ event_id: EVENT_ID }]);

			await expect(companions.run({
				businessEffect: async () => {
					await boundary.execute("INSERT INTO business_probe (label) VALUES (?)", ["rolled-back"]);
				},
				delivery: { ...delivery, id: "66666666-6666-4666-8666-666666666666", idempotencyKey: "atomic.delivery.rollback" },
				event: { ...event, eventId: "77777777-7777-4777-8777-777777777777", idempotencyKey: "atomic.event.rollback", eventType: "not_an_event" as never },
			})).rejects.toThrow();
			expect(await boundary.query("SELECT label FROM business_probe ORDER BY id")).toEqual([{ label: "committed" }]);
			expect(await boundary.query("SELECT count(*) AS count FROM outbox_deliveries")).toEqual([{ count: 1 }]);
			expect(await boundary.query("SELECT count(*) AS count FROM product_events")).toEqual([{ count: 1 }]);
		});
	});

	it("event idempotency appends exact taxonomy with explicit safe attributes", async () => {
		await withDatabase(async (boundary, clock) => {
			const { events } = createServices(boundary, clock);
			const request = {
				eventId: EVENT_ID,
				idempotencyKey: "event.semantic.1",
				eventType: "collaboration_published" as const,
				safeAttributes: createSafeAttributes("collaboration_published", { count: 2 }),
				profileId: "profile-1",
				collaborationId: "collaboration-1",
				occurredAt: clock.now().getTime(),
			};
			const created = await events.append(request);
			expect(created.eventType).toBe("collaboration_published");
			clock.advanceBy(1_000);
			expect(await events.append({
				...request,
				eventId: "33333333-3333-4333-8333-333333333333",
				occurredAt: clock.now().getTime(),
			})).toEqual(created);
			await expect(events.append({
				...request,
				eventId: "88888888-8888-4888-8888-888888888888",
				safeAttributes: createSafeAttributes("collaboration_published", { count: 3 }),
			})).rejects.toBeInstanceOf(ProductEventIdempotencyConflictError);
			await expect(events.append({
				...request,
				idempotencyKey: "event.primary-id-conflict",
			})).rejects.toBeInstanceOf(ProductEventIdConflictError);
			await expect(events.append({
				...request,
				eventId: "99999999-9999-4999-8999-999999999999",
				idempotencyKey: "event.raw",
				safeAttributes: { message: "raw content" } as never,
			})).rejects.toThrow();
			expect(() => createSafeAttributes("collaboration_published", { unknown: true } as never)).toThrow();
			expect(() => createSafeAttributes("collaboration_published", { count: Number.NaN } as never)).toThrow();
			expect(() => createSafeAttributes("collaboration_published", { count: [2] } as never)).toThrow();
			expect(() => createSafeAttributes("collaboration_published", { count: 2, toJSON: () => ({ token: "unexpected-value" }) } as never)).toThrow();
			const rows = await boundary.query<{ event_type: string; safe_attributes_json: string }>("SELECT event_type, safe_attributes_json FROM product_events");
			expect(rows).toEqual([{ event_type: "collaboration_published", safe_attributes_json: '{"count":2}' }]);
		});
	});
});
