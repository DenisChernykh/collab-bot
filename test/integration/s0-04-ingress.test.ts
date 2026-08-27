import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { CommandContext } from "../../src/application/commands/command-contracts.js";
import {
	CommandConflictError,
	CommandIncidentError,
	DurableCommandExecutor,
} from "../../src/application/commands/command-executor.js";
import {
	CallbackActionService,
	CallbackActorValidationError,
} from "../../src/application/commands/callback-action.js";
import {
	normalizeTelegramUserActor,
	RequireActiveActor,
} from "../../src/application/commands/require-active-actor.js";
import { SqliteTelegramUserRepository } from "../../src/infrastructure/database/telegram-user-repository.js";
import { SqliteCallbackActionRepository } from "../../src/infrastructure/database/callback-action-repository.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { NodeOpaqueTokenCodec, Sha256CanonicalInputHasher } from "../../src/infrastructure/crypto/ingress-codecs.js";
import { CallbackActionStoreCorruptError } from "../../src/application/ports/callback-action-store.js";
import { IngressRetentionService } from "../../src/infrastructure/database/ingress-retention.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { FakeClock } from "../support/fake-clock.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";
import { hashOpaqueToken } from "../../src/infrastructure/crypto/tokens.js";

const canonicalMigrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

async function withDatabase<T>(work: (boundary: DatabaseBoundary, clock: FakeClock) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s0-04-ingress-"));
	const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
	const clock = new FakeClock(10 * DAY_MS);
	try {
		const source = await MigrationSource.fromDirectory(canonicalMigrationsPath);
		await new MigrationRunner(source, clock).migrate(boundary);
		return await work(boundary, clock);
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

function telegramContext(commandId: string, updateId: number, telegramUserId = "100"): CommandContext {
	return {
		commandId,
		telegramUpdateId: updateId,
		actor: { kind: "telegram_user", telegramUserId },
		occurredAt: new Date(10 * DAY_MS),
	};
}

function adminContext(commandId: string): CommandContext {
	return {
		commandId,
		actor: { kind: "admin", telegramUserId: "900" },
		occurredAt: new Date(10 * DAY_MS),
	};
}

function adminTelegramContext(commandId: string, updateId: number): CommandContext {
	return {
		commandId,
		telegramUpdateId: updateId,
		actor: { kind: "admin", telegramUserId: "900" },
		occurredAt: new Date(10 * DAY_MS),
	};
}

function runnerContext(commandId: string, runner: "cleanup" | "delivery"): CommandContext {
	return {
		commandId,
		actor: { kind: "runner", runner },
		occurredAt: new Date(10 * DAY_MS),
	};
}

function createExecutor(boundary: DatabaseBoundary, clock: FakeClock): DurableCommandExecutor {
	return new DurableCommandExecutor(
		new DatabaseBoundaryTransactionRunner(boundary),
		new SqliteDurableCommandStore(boundary),
		new Sha256CanonicalInputHasher(),
		clock,
	);
}

const completedResult = {
	version: 1 as const,
	outcome: "completed" as const,
	messageKey: "command_completed" as const,
};

async function insertUser(boundary: DatabaseBoundary, id: string, status: "active" | "blocked" = "active"): Promise<void> {
	await boundary.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[id, null, `User ${id}`, status, status === "blocked" ? 1 : null, 0, 0],
	);
}

describe("durable command executor", () => {
	it("persists allowlisted Telegram admin updates as Telegram receipts and replays once", async () => {
		await withDatabase(async (boundary, clock) => {
			const executor = createExecutor(boundary, clock);
			let effects = 0;
			const request = {
				context: adminTelegramContext("telegram:update:9", 9),
				input: { kind: "message", text: "/admin hide https://t.me/collab_bot?start=c_token internal reason" } as const,
				effect: async () => {
					effects += 1;
					return completedResult;
				},
			};

			expect(await executor.execute(request)).toEqual(completedResult);
			expect(await executor.execute(request)).toEqual(completedResult);
			expect(effects).toBe(1);
			expect(await boundary.query("SELECT command_id, source, telegram_update_id, status FROM command_receipts WHERE command_id = 'telegram:update:9'")).toEqual([{
				command_id: "telegram:update:9",
				source: "telegram",
				telegram_update_id: 9,
				status: "completed",
			}]);
			expect(await boundary.query("SELECT update_id, command_id FROM processed_updates WHERE update_id = 9")).toEqual([{
				update_id: 9,
				command_id: "telegram:update:9",
			}]);
		});
	});

	it("command replay and input hash conflict reject source/update conflicts without effects", async () => {
		await withDatabase(async (boundary, clock) => {
			await boundary.execute("CREATE TABLE effect_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
			const executor = createExecutor(boundary, clock);
			let effects = 0;
			const request = {
				context: telegramContext("command-1", 10),
				input: { action: "safe" } as const,
				effect: async () => {
					effects += 1;
					await boundary.execute("INSERT INTO effect_probe (label) VALUES (?)", ["once"]);
					return completedResult;
				},
			};

			expect(await executor.execute(request)).toEqual(completedResult);
			expect(await executor.execute(request)).toEqual(completedResult);
			expect(effects).toBe(1);

			await expect(executor.execute({
				...request,
				input: { action: "different" },
			})).rejects.toBeInstanceOf(CommandConflictError);
			await expect(executor.execute({
				...request,
				context: adminContext("command-1"),
			})).rejects.toBeInstanceOf(CommandConflictError);
			await expect(executor.execute({
				...request,
				context: telegramContext("command-1", 11),
			})).rejects.toBeInstanceOf(CommandConflictError);
			await expect(executor.execute({
				...request,
				context: telegramContext("command-2", 10),
			})).rejects.toBeInstanceOf(CommandConflictError);
			await expect(executor.execute({
				...request,
				context: telegramContext("command-1", 10, "101"),
			})).rejects.toBeInstanceOf(CommandConflictError);
			await expect(executor.execute({
				...request,
				context: { ...request.context, occurredAt: new Date(10 * DAY_MS + 1) },
			})).rejects.toBeInstanceOf(CommandConflictError);

			const operatorRequest = {
				context: adminContext("operator-replay"),
				input: { action: "operator" } as const,
				effect: async () => {
					effects += 1;
					return completedResult;
				},
			};
			await expect(executor.execute(operatorRequest)).resolves.toEqual(completedResult);
			await expect(executor.execute({
				...operatorRequest,
				context: { ...operatorRequest.context, actor: { kind: "admin", telegramUserId: "901" } },
			})).rejects.toBeInstanceOf(CommandConflictError);

			const runnerRequest = {
				context: runnerContext("runner-replay", "cleanup"),
				input: { action: "runner" } as const,
				effect: async () => {
					effects += 1;
					return completedResult;
				},
			};
			await expect(executor.execute(runnerRequest)).resolves.toEqual(completedResult);
			await expect(executor.execute({
				...runnerRequest,
				context: runnerContext("runner-replay", "delivery"),
			})).rejects.toBeInstanceOf(CommandConflictError);
			expect(effects).toBe(3);
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM effect_probe")).toEqual([{ count: 1 }]);
		});
	});

	it("duplicate update rollback removes transient receipt/effect and reports persistent operator incidents", async () => {
		await withDatabase(async (boundary, clock) => {
			await boundary.execute("CREATE TABLE effect_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
			const executor = createExecutor(boundary, clock);
			const request = {
				context: telegramContext("rollback-command", 20),
				input: { action: "rollback" } as const,
				effect: async () => {
					await boundary.execute("INSERT INTO effect_probe (label) VALUES (?)", ["rolled-back"]);
					throw new Error("effect failure");
				},
			};

			await expect(executor.execute(request)).rejects.toThrow("effect failure");
			expect(await boundary.query("SELECT * FROM command_receipts WHERE command_id = ?", ["rollback-command"])).toEqual([]);
			expect(await boundary.query("SELECT * FROM processed_updates WHERE update_id = ?", [20])).toEqual([]);
			expect(await boundary.query("SELECT * FROM effect_probe")).toEqual([]);

			const incidentInput = { action: "incident" } as const;
			await boundary.execute(
				"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				[
					"operator-incident",
					"operator",
					null,
					hashCanonicalInput({
						actor: { kind: "admin", telegramUserId: "900" },
						occurredAt: clock.now().getTime(),
						input: incidentInput,
					}),
					"in_progress",
					null,
					clock.now().getTime(),
					null,
				],
			);
			await expect(executor.execute({
				context: adminContext("operator-incident"),
				input: incidentInput,
				effect: () => completedResult,
			})).rejects.toBeInstanceOf(CommandIncidentError);
		});
	});
});

describe("active actor guard and callback actions", () => {
	it("is lookup-only and refuses blocked, missing, group/channel, admin, and runner actors", async () => {
		await withDatabase(async (boundary) => {
			await insertUser(boundary, "100");
			await insertUser(boundary, "200", "blocked");
			const guard = new RequireActiveActor(new SqliteTelegramUserRepository(boundary));
			const active = await guard.check({ kind: "telegram_user", telegramUserId: "100" });
			const blocked = await guard.check({ kind: "telegram_user", telegramUserId: "200" });
			const missing = await guard.check({ kind: "telegram_user", telegramUserId: "300" });
			const group = await guard.check({ kind: "telegram_user", telegramUserId: "-100300" });
			const admin = await guard.check({ kind: "admin", telegramUserId: "900" });
			const runner = await guard.check({ kind: "runner", runner: "cleanup" });

			expect(active).toMatchObject({ allowed: true });
			expect(blocked).toMatchObject({ allowed: false, result: { outcome: "blocked", messageKey: "actor_blocked" } });
			expect(missing).toMatchObject({ allowed: false, result: { outcome: "unavailable", messageKey: "actor_unavailable" } });
			expect(group).toMatchObject({ allowed: false, result: { outcome: "unavailable", messageKey: "actor_unavailable" } });
			expect(admin).toMatchObject({ allowed: false, result: { outcome: "unavailable", messageKey: "actor_unavailable" } });
			expect(runner).toMatchObject({ allowed: false, result: { outcome: "unavailable", messageKey: "actor_unavailable" } });
			expect(normalizeTelegramUserActor({ kind: "telegram_user", telegramUserId: "-100" })).toBeUndefined();
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM telegram_users")).toEqual([{ count: 2 }]);
		});
	});

	it("actor-bound callback stores only token hash, enforces allowlist and one-shot replay", async () => {
		await withDatabase(async (boundary, clock) => {
			await insertUser(boundary, "100");
			await insertUser(boundary, "101");
			const executor = createExecutor(boundary, clock);
			const actionRepository = new SqliteCallbackActionRepository(boundary);
			const guard = new RequireActiveActor(new SqliteTelegramUserRepository(boundary));
			const versions = new Map([["entity-1", 1]]);
			const service = new CallbackActionService({
				transactionRunner: new DatabaseBoundaryTransactionRunner(boundary),
				clock,
				executor,
				repository: actionRepository,
				actorGuard: guard,
				allowedActionTypes: new Set(["foundation.action"]),
				currentVersion: (entityId) => versions.get(entityId),
				tokenCodec: new NodeOpaqueTokenCodec(),
			});
			await expect(actionRepository.consume("f".repeat(64), clock.now().getTime(), JSON.stringify(completedResult))).rejects.toBeInstanceOf(CallbackActionStoreCorruptError);
			const token = await service.create({
				actor: { kind: "telegram_user", telegramUserId: "100" },
				actionType: "foundation.action",
				entityId: "entity-1",
				expectedVersion: 1,
				mode: "one_shot",
				expiresAt: clock.now().getTime() + DAY_MS,
			});
			expect(token).toMatch(/^cb_[A-Za-z0-9_-]+$/);
			expect(token.length).toBeLessThanOrEqual(64);
			expect(await boundary.query("SELECT * FROM telegram_actions")).not.toContainEqual(expect.objectContaining({ token_hash: token }));

			await expect(service.create({
				actor: { kind: "telegram_user", telegramUserId: "100" },
				actionType: "product.not-allowed",
				mode: "one_shot",
				expiresAt: clock.now().getTime() + DAY_MS,
			})).rejects.toThrow();
			await expect(service.create({
				actor: { kind: "telegram_user", telegramUserId: "-100" },
				actionType: "foundation.action",
				mode: "one_shot",
				expiresAt: clock.now().getTime() + DAY_MS,
			} as never)).rejects.toBeInstanceOf(CallbackActorValidationError);

			let effects = 0;
			const invoke = (commandId: string, updateId: number, actor = "100") => service.invoke({
				context: telegramContext(commandId, updateId, actor),
				callbackPayload: token,
				effect: () => {
					effects += 1;
					return completedResult;
				},
			});
			expect(await invoke("callback-1", 30)).toEqual(completedResult);
			expect(await invoke("callback-1", 30)).toEqual(completedResult);
			expect(await invoke("callback-2", 31)).toEqual(completedResult);
			expect(effects).toBe(1);
			const actorCollision = await service.invoke({
				context: telegramContext("callback-1", 30, "101"),
				callbackPayload: token,
				effect: () => {
					effects += 1;
					return completedResult;
				},
			});
			expect(actorCollision).toMatchObject({ outcome: "unavailable", messageKey: "callback_unavailable" });
			expect(effects).toBe(1);

			const foreign = await service.invoke({
				context: telegramContext("callback-foreign", 32, "101"),
				callbackPayload: token,
				effect: () => {
					effects += 1;
					return completedResult;
				},
			});
			expect(foreign).toMatchObject({ outcome: "unavailable", messageKey: "callback_unavailable" });
			expect(effects).toBe(1);

			const unknown = await service.invoke({
				context: telegramContext("callback-unknown", 33),
				callbackPayload: "cb_unknown-token",
				effect: () => completedResult,
			});
			expect(unknown).toMatchObject({ outcome: "unavailable", messageKey: "callback_unavailable" });
			const group = await service.invoke({
				context: telegramContext("callback-group", 34, "-100300") as CommandContext,
				callbackPayload: token,
				effect: () => completedResult,
			});
			expect(group).toMatchObject({ outcome: "unavailable", messageKey: "callback_unavailable" });
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM telegram_users")).toEqual([{ count: 2 }]);
		});
	});

	it("actor-bound callback returns stale/expired safely, supports reusable actions, and rolls back consumption", async () => {
		await withDatabase(async (boundary, clock) => {
			await insertUser(boundary, "100");
			const executor = createExecutor(boundary, clock);
			const repository = new SqliteCallbackActionRepository(boundary);
			const guard = new RequireActiveActor(new SqliteTelegramUserRepository(boundary));
			const versions = new Map([["stale-entity", 2]]);
			const service = new CallbackActionService({
				transactionRunner: new DatabaseBoundaryTransactionRunner(boundary),
				clock,
				executor,
				repository,
				actorGuard: guard,
				allowedActionTypes: new Set(["foundation.action"]),
				currentVersion: (entityId) => versions.get(entityId),
				tokenCodec: new NodeOpaqueTokenCodec(),
			});
			const staleToken = await service.create({
				actor: { kind: "telegram_user", telegramUserId: "100" },
				actionType: "foundation.action",
				entityId: "stale-entity",
				expectedVersion: 1,
				mode: "one_shot",
				expiresAt: clock.now().getTime() + DAY_MS,
			});
			expect(await service.invoke({
				context: telegramContext("stale", 40),
				callbackPayload: staleToken,
				effect: () => completedResult,
			})).toMatchObject({ outcome: "stale", messageKey: "callback_stale" });

			const expiredToken = await service.create({
				actor: { kind: "telegram_user", telegramUserId: "100" },
				actionType: "foundation.action",
				mode: "one_shot",
				expiresAt: clock.now().getTime() + 100,
			});
			clock.advanceBy(100);
			expect(await service.invoke({
				context: telegramContext("expired", 41),
				callbackPayload: expiredToken,
				effect: () => completedResult,
			})).toMatchObject({ outcome: "expired", messageKey: "callback_expired" });
			expect(await service.cleanupExpired()).toBe(1);

			const reusableToken = await service.create({
				actor: { kind: "telegram_user", telegramUserId: "100" },
				actionType: "foundation.action",
				mode: "reusable",
				expiresAt: clock.now().getTime() + DAY_MS,
			});
			let reusableEffects = 0;
			const reusableEffect = () => {
				reusableEffects += 1;
				return completedResult;
			};
			expect(await service.invoke({ context: telegramContext("reusable-1", 42), callbackPayload: reusableToken, effect: reusableEffect })).toEqual(completedResult);
			expect(await service.invoke({ context: telegramContext("reusable-1", 42), callbackPayload: reusableToken, effect: reusableEffect })).toEqual(completedResult);
			expect(await service.invoke({ context: telegramContext("reusable-2", 43), callbackPayload: reusableToken, effect: reusableEffect })).toEqual(completedResult);
			expect(reusableEffects).toBe(2);
		expect(await boundary.query("SELECT consumed_at FROM telegram_actions WHERE mode = 'reusable'")).toEqual([{ consumed_at: null }]);

			const rollbackToken = await service.create({
				actor: { kind: "telegram_user", telegramUserId: "100" },
				actionType: "foundation.action",
				mode: "one_shot",
				expiresAt: clock.now().getTime() + DAY_MS,
			});
			await expect(service.invoke({
				context: telegramContext("callback-rollback", 44),
				callbackPayload: rollbackToken,
				effect: async () => {
					throw new Error("callback effect failure");
				},
			})).rejects.toThrow("callback effect failure");
			expect(await boundary.query("SELECT consumed_at FROM telegram_actions WHERE token_hash = ?", [hashOpaqueToken(rollbackToken)])).toEqual([{ consumed_at: null }]);
			expect(await service.invoke({
			context: telegramContext("callback-after-rollback", 45),
			callbackPayload: rollbackToken,
			effect: () => completedResult,
		})).toEqual(completedResult);
		});
	});
});

describe("ingress retention", () => {
	it("keeps the latest 50,000 IDs and seven-day boundary while removing only their completed Telegram receipts", async () => {
		await withDatabase(async (boundary, clock) => {
			const base = clock.now().getTime() - 8 * DAY_MS;
			await boundary.withTransaction(async ({ client }) => {
				const receipt = client.prepare(
					"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, 'telegram', ?, ?, 'completed', ?, ?, ?)",
				);
				const update = client.prepare("INSERT INTO processed_updates (update_id, command_id, processed_at) VALUES (?, ?, ?)");
				for (let updateId = 1; updateId <= 50_001; updateId += 1) {
					const commandId = `bulk-${updateId}`;
					const processedAt = updateId <= 2 ? base : clock.now().getTime();
					receipt.run(commandId, updateId, "a".repeat(64), '{"version":1,"outcome":"completed","messageKey":"command_completed"}', processedAt, processedAt);
					update.run(updateId, commandId, processedAt);
				}
			});
			await boundary.execute(
				"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["operator-preserve", "operator", null, "b".repeat(64), "in_progress", null, base, null],
			);
			await boundary.execute(
				"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["runner-preserve", "runner", null, "c".repeat(64), "completed", '{"version":1,"outcome":"completed","messageKey":"command_completed"}', base, base],
			);

			const result = await new IngressRetentionService(boundary, clock).cleanup();
			expect(result).toEqual({ processedUpdatesDeleted: 1, receiptsDeleted: 1 });
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM processed_updates")).toEqual([{ count: 50_000 }]);
			expect(await boundary.query("SELECT update_id FROM processed_updates WHERE update_id IN (1, 2)")).toEqual([{ update_id: 2 }]);
			expect(await boundary.query("SELECT command_id FROM command_receipts WHERE command_id IN ('bulk-1', 'bulk-2', 'operator-preserve', 'runner-preserve') ORDER BY command_id")).toEqual([
				{ command_id: "bulk-2" },
				{ command_id: "operator-preserve" },
				{ command_id: "runner-preserve" },
			]);
		});
	});
});
