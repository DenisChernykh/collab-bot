/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { DurableCommandExecutor } from "../../src/shared/application/commands/command-executor.js";
import { hashCanonicalInput } from "../../src/platform/crypto/canonical-input-hash.js";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { SqliteDurableCommandStore } from "../../src/platform/database/durable-command-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { SystemClock } from "../../src/platform/time/system-clock.js";

interface Capability {
	canPublish: boolean;
	reason: string | null;
}

interface TestApplication {
	readonly bot: { readonly handleUpdate: (update: unknown) => Promise<void> };
	readonly lifecycle: {
		readonly initializeIdentity: () => Promise<void>;
		readonly preflightShowcase: () => Promise<void>;
	};
	readonly showcaseCapability: () => Capability;
	readonly runDeliveryCycleOnce: () => Promise<void>;
}

interface TestInstance {
	environment: Record<string, string | undefined>;
	application: TestApplication;
}

const environment = (): Record<string, string> => ({
	BOT_TOKEN: "review-development-token",
	EXPECTED_BOT_ID: "7001",
	EXPECTED_BOT_USERNAME: "collaboration_bot_development",
	SHOWCASE_CHANNEL_ID: "-1007001",
	SHOWCASE_CHANNEL_USERNAME: "collaboration_showcase_development",
});

function patchInstance(instance: unknown, capability: Capability, identity: () => Promise<void>, preflight: () => Promise<void>): void {
	const typed = instance as TestInstance;
	typed.environment = environment();
	typed.application = {
		bot: { handleUpdate: vi.fn(async () => undefined) },
		lifecycle: { initializeIdentity: identity, preflightShowcase: preflight },
		showcaseCapability: () => capability,
		runDeliveryCycleOnce: vi.fn(async () => undefined),
	};
}

async function update(stub: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }): Promise<Response> {
	return stub.fetch("https://local/__cf1/update", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ update_id: 901 }),
	});
}

describe("CF1 consolidated launch regressions", () => {
	it("reinitializes identity before using a positive persisted capability on a new handler instance", async () => {
		const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-review-positive-eviction"));
		await stub.fetch("https://local/__cf1/schema");
		await runInDurableObject(stub, async (_instance, state) => {
			expect(state.storage.sql.exec("SELECT count(*) AS count FROM __app_migrations").toArray()).toEqual([{ count: 17 }]);
		});
		const secondIdentity = vi.fn(async () => undefined);
		const secondPreflight = vi.fn(async () => undefined);
		await runInDurableObject(stub, async (instance, state) => {
			patchInstance(instance, { canPublish: true, reason: null }, secondIdentity, secondPreflight);
			state.storage.sql.exec(
				"INSERT INTO cf1_preflight_cache (id, bot_id, bot_username, showcase_channel_id, showcase_channel_username, can_publish, reason, checked_at) VALUES (1, '7001', 'collaboration_bot_development', '-1007001', 'collaboration_showcase_development', 1, NULL, ?)",
				Date.now(),
			).toArray();
		});
		expect((await update(stub)).status).toBe(204);
		expect(secondIdentity).toHaveBeenCalledTimes(1);
		expect(secondPreflight).not.toHaveBeenCalled();
	});

	it("fails closed on identity mismatch and retries the exact preflight on the next request", async () => {
		const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-review-identity-retry"));
		await stub.fetch("https://local/__cf1/schema");
		const mismatch = vi.fn(async () => { throw new Error("Telegram bot identity mismatch"); });
		const unusedPreflight = vi.fn(async () => undefined);
		await runInDurableObject(stub, (instance) => patchInstance(instance, { canPublish: false, reason: "showcase preflight has not run" }, mismatch, unusedPreflight));
		const failed = await stub.fetch("https://local/__cf1/ready");
		expect(failed.status).toBe(503);
		expect(await failed.json()).toEqual({ status: "not_ready", reason: "preflight_failed" });
		expect(mismatch).toHaveBeenCalledTimes(1);

		const recoveredCapability = { canPublish: true, reason: null };
		const recoveredIdentity = vi.fn(async () => undefined);
		const recoveredPreflight = vi.fn(async () => undefined);
		await runInDurableObject(stub, (instance) => patchInstance(instance, recoveredCapability, recoveredIdentity, recoveredPreflight));
		const recovered = await stub.fetch("https://local/__cf1/ready");
		expect(recovered.status).toBe(200);
		expect(await recovered.json()).toEqual({
			status: "ready",
			identity: "verified",
			showcase: { canPublish: true, reason: null },
			durableObject: "CollaborationBotState",
		});
		expect(recoveredIdentity).toHaveBeenCalledTimes(1);
		expect(recoveredPreflight).toHaveBeenCalledTimes(1);
	});

	it("rechecks a degraded showcase cache and schedules a recovered channel intent", async () => {
		const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-review-showcase-recovery"));
		await stub.fetch("https://local/__cf1/schema");
		await runInDurableObject(stub, async (_instance, state) => expect(state.storage.sql.exec("SELECT count(*) AS count FROM __app_migrations").toArray()).toEqual([{ count: 17 }]));
		const createdAt = Date.now() + 10_000;
		const recoveredCapability = { canPublish: true, reason: null };
		const recoveredIdentity = vi.fn(async () => undefined);
		const recoveredPreflight = vi.fn(async () => undefined);
		await runInDurableObject(stub, async (_instance, state) => {
			patchInstance(_instance, recoveredCapability, recoveredIdentity, recoveredPreflight);
			state.storage.sql.exec(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000901', 'cf1-review:channel:901', 'channel_send', '-1007001', NULL, ?, 'prepared', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)",
				JSON.stringify({ version: 1, method: "send", text: "review channel intent" }),
				createdAt,
				createdAt,
			).toArray();
			state.storage.sql.exec(
				"INSERT INTO cf1_preflight_cache (id, bot_id, bot_username, showcase_channel_id, showcase_channel_username, can_publish, reason, checked_at) VALUES (1, '7001', 'collaboration_bot_development', '-1007001', 'collaboration_showcase_development', 0, 'showcase bot capabilities are insufficient', ?)",
				createdAt,
			).toArray();
		});
		const recovered = await stub.fetch("https://local/__cf1/ready");
		expect(recovered.status).toBe(200);
		expect(await recovered.json()).toMatchObject({ status: "ready", showcase: recoveredCapability });
		expect(recoveredIdentity).toHaveBeenCalledTimes(1);
		expect(recoveredPreflight).toHaveBeenCalledTimes(1);
		await runInDurableObject(stub, async (_instance, state) => expect(await state.storage.getAlarm()).not.toBeNull());
	});

	it("atomically commits receipt, business row and outbox once, then rolls all three back on failure", async () => {
		const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-review-atomic-ingress"));
		await stub.fetch("https://local/__cf1/schema");
		await runInDurableObject(stub, async (_instance, state) => {
			const clock = new SystemClock();
			const createExecutor = (): { executor: DurableCommandExecutor; database: CloudflareSqlDatabase } => {
				const database = new CloudflareSqlDatabase(state.storage);
				return {
					database,
					executor: new DurableCommandExecutor(
						new DatabaseBoundaryTransactionRunner(database),
						new SqliteDurableCommandStore(database),
						{ hash: hashCanonicalInput },
						clock,
					),
				};
			};
			const createRequest = (commandId: string, updateId: number, userId: string, deliveryId: string, fail = false) => {
				const { executor, database } = createExecutor();
				return {
					executor,
					request: {
						context: {
							commandId,
							telegramUpdateId: updateId,
							actor: { kind: "telegram_user" as const, telegramUserId: userId },
							occurredAt: new Date(1_700_000_000_000),
						},
						input: { kind: "message", text: `review-${commandId}` },
						effect: async () => {
							await database.execute(
								"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, ?, 'active', NULL, ?, ?)",
								[userId, `Review User ${userId}`, 1_700_000_000_000, 1_700_000_000_000],
							);
							await database.execute(
								"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, 'dm_send', ?, NULL, ?, 'prepared', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)",
								[deliveryId, `${commandId}:outbox`, userId, JSON.stringify({ version: 1, method: "send", text: "atomic review" }), 1_700_000_000_000, 1_700_000_000_000],
							);
							if (fail) throw new Error("synthetic business failure");
							return { version: 1 as const, outcome: "completed" as const, messageKey: "command_completed" as const };
						},
					},
				};
			};

			const first = createRequest("telegram:update:review-atomic", 9301, "9301", "00000000-0000-4000-8000-000000000931");
			const duplicate = createRequest("telegram:update:review-atomic", 9301, "9301", "00000000-0000-4000-8000-000000000931");
			const [firstResult, duplicateResult] = await Promise.all([
				first.executor.execute(first.request),
				duplicate.executor.execute(duplicate.request),
			]);
			const inspectionDatabase = new CloudflareSqlDatabase(state.storage);
			expect(firstResult).toEqual(duplicateResult);
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM command_receipts")).toEqual([{ count: 1 }]);
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM processed_updates")).toEqual([{ count: 1 }]);
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM telegram_users WHERE telegram_user_id = '9301'")).toEqual([{ count: 1 }]);
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM outbox_deliveries WHERE id = '00000000-0000-4000-8000-000000000931'")).toEqual([{ count: 1 }]);

			const rollback = createRequest("telegram:update:review-rollback", 9302, "9302", "00000000-0000-4000-8000-000000000932", true);
			await expect(rollback.executor.execute(rollback.request)).rejects.toThrow("synthetic business failure");
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM command_receipts WHERE command_id = 'telegram:update:review-rollback'")).toEqual([{ count: 0 }]);
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM processed_updates WHERE update_id = 9302")).toEqual([{ count: 0 }]);
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM telegram_users WHERE telegram_user_id = '9302'")).toEqual([{ count: 0 }]);
			expect(await inspectionDatabase.query("SELECT count(*) AS count FROM outbox_deliveries WHERE id = '00000000-0000-4000-8000-000000000932'")).toEqual([{ count: 0 }]);
		});
	});
});
