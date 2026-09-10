/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { exportStateTransferManifest, importStateTransferManifest } from "../../src/platform/database/state-transfer.js";
import type { SqlDatabase } from "../../src/shared/application/ports/sql-database.js";
import worker from "../../src/worker.js";

const REVIEW_OPERATIONS_TOKEN = "cf1-review-operations-token";

describe("CF1-08 local Durable Object transfer", () => {
	it("preserves the logical digest across a local DO export/import", async () => {
		const source = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-transfer-source"));
		const target = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-transfer-target"));
		await source.fetch("https://local/__cf1/ready");
		const manifest = await runInDurableObject(source, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			await database.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
				["8001", "transfer_user", "Transfer User", 3_000_000, 3_000_000],
			);
			return exportStateTransferManifest(database);
		});
		expect(manifest.tables).toHaveLength(25);
		expect(manifest.tables.map((table) => table.name)).not.toContain("__app_migrations");

		await target.fetch("https://local/__cf1/ready");
		const imported = await runInDurableObject(target, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			return importStateTransferManifest(database, manifest, () => 3_000_001);
		});
		expect(imported).toMatchObject({ digest: manifest.digest, tableCount: 25, rowCount: 1 });
		const targetManifest = await runInDurableObject(target, (_instance, state) => exportStateTransferManifest(new CloudflareSqlDatabase(state.storage)));
		expect(targetManifest.digest).toBe(manifest.digest);
		await expect(runInDurableObject(target, async (_instance, state) => importStateTransferManifest(new CloudflareSqlDatabase(state.storage), manifest))).rejects.toThrow("state transfer target is not empty");
		const tampered = { ...manifest, digest: "0".repeat(64) };
		await expect(runInDurableObject(target, async (_instance, state) => importStateTransferManifest(new CloudflareSqlDatabase(state.storage), tampered))).rejects.toThrow("state transfer manifest validation failed");
	});

	it("exports the allowlisted local state and keeps the protected import route disabled", async () => {
		const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-protected-transfer"));
		const exported = await stub.fetch("https://local/__cf1/state/export");
		expect(exported.status).toBe(200);
		const manifest = await exported.json() as { tables: readonly { name: string }[]; digest: string };
		expect(manifest.tables).toHaveLength(25);
		expect(manifest.tables.map((table) => table.name)).not.toContain("__app_migrations");
		expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/u);
		const disabled = await stub.fetch("https://local/__cf1/state/import", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(manifest),
		});
		expect(disabled.status).toBe(403);
	});

	it("imports through the protected Worker route with a synthetic token and preserves digest parity", async () => {
		const source = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-auth-source"));
		const target = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("collaboration-bot-primary"));
		await source.fetch("https://local/__cf1/ready");
		const manifest = await runInDurableObject(source, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			await database.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
				["8003", "auth_transfer_user", "Authenticated Transfer User", 3_000_000, 3_000_000],
			);
			return exportStateTransferManifest(database);
		});
		await target.fetch("https://local/__cf1/ready");
		await runInDurableObject(target, (instance) => {
			const durableObject = instance as unknown as { environment: Record<string, unknown> };
			durableObject.environment = { ...durableObject.environment, STATE_IMPORT_ENABLED: "true" };
		});

		const runtimeEnvironment = {
			COLLABORATION_STATE: env.COLLABORATION_STATE,
			OPERATIONS_TOKEN: REVIEW_OPERATIONS_TOKEN,
			STATE_IMPORT_ENABLED: "true",
		} as unknown as Env;
		const authorizedHeaders = {
			authorization: `Bearer ${REVIEW_OPERATIONS_TOKEN}`,
			"content-type": "application/json",
		};
		const imported = await worker.fetch(new Request("https://local/ops/state/import", {
			method: "POST",
			headers: authorizedHeaders,
			body: JSON.stringify(manifest),
		}), runtimeEnvironment);
		expect(imported.status).toBe(200);
		expect(await imported.json()).toMatchObject({ digest: manifest.digest, tableCount: 25, rowCount: 1 });

		const exported = await worker.fetch(new Request("https://local/ops/state/export", {
			headers: { authorization: `Bearer ${REVIEW_OPERATIONS_TOKEN}` },
		}), runtimeEnvironment);
		expect(exported.status).toBe(200);
		const exportedManifest = await exported.json() as typeof manifest;
		expect(exportedManifest.digest).toBe(manifest.digest);

		const repeated = await worker.fetch(new Request("https://local/ops/state/import", {
			method: "POST",
			headers: authorizedHeaders,
			body: JSON.stringify(manifest),
		}), runtimeEnvironment);
		expect(repeated.status).toBe(409);

		const tampered = { ...manifest, digest: "0".repeat(64) };
		const tamperedResponse = await worker.fetch(new Request("https://local/ops/state/import", {
			method: "POST",
			headers: authorizedHeaders,
			body: JSON.stringify(tampered),
		}), runtimeEnvironment);
		expect(tamperedResponse.status).toBe(422);
		const afterTamper = await worker.fetch(new Request("https://local/ops/state/export", {
			headers: { authorization: `Bearer ${REVIEW_OPERATIONS_TOKEN}` },
		}), runtimeEnvironment);
		expect(afterTamper.status).toBe(200);
		expect((await afterTamper.json() as typeof manifest).digest).toBe(manifest.digest);
	});

	it("rolls back a Durable Object import when a later table write fails", async () => {
		const source = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-transfer-rollback-source"));
		const target = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("cf1-08-transfer-rollback-target"));
		await source.fetch("https://local/__cf1/ready");
		const manifest = await runInDurableObject(source, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			await database.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
				["8002", "rollback_user", "Rollback User", 3_000_000, 3_000_000],
			);
			await database.execute(
				"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, 'profile.open', NULL, NULL, 'one_shot', ?, NULL, NULL)",
				["b".repeat(64), "8002", 3_001_000],
			);
			return exportStateTransferManifest(database);
		});
		await target.fetch("https://local/__cf1/ready");
		await runInDurableObject(target, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			let interrupted = false;
			const failingDatabase: SqlDatabase = {
				query: (sql, parameters) => database.query(sql, parameters),
				execute: (sql, parameters) => {
					if (!interrupted && sql.startsWith('INSERT INTO "telegram_actions"')) {
						interrupted = true;
						return Promise.reject(new Error("synthetic transfer interruption"));
					}
					return database.execute(sql, parameters);
				},
				withTransaction: (work) => database.withTransaction(work),
			};
			await expect(importStateTransferManifest(failingDatabase, manifest)).rejects.toThrow("synthetic transfer interruption");
			expect(await database.query("SELECT count(*) AS count FROM telegram_users")).toEqual([{ count: 0 }]);
			expect(await database.query("SELECT count(*) AS count FROM telegram_actions")).toEqual([{ count: 0 }]);
			expect(await database.query("SELECT count(*) AS count FROM cf1_state_import_audit")).toEqual([{ count: 0 }]);
		});
	});
});
