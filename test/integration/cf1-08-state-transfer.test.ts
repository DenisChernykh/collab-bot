import { describe, expect, it } from "vitest";

import {
	exportStateTransferManifest,
	importStateTransferManifest,
	STATE_TRANSFER_AUDIT_TABLE,
	StateTransferConflictError,
	StateTransferValidationError,
} from "../../src/platform/database/state-transfer.js";
import type { SqlDatabase } from "../../src/shared/application/ports/sql-database.js";
import { FakeClock } from "../support/fake-clock.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";

const clock = new FakeClock(1_000_000);

async function prepareAuditTable(database: SqlDatabase): Promise<void> {
	await database.execute(`
		CREATE TABLE ${STATE_TRANSFER_AUDIT_TABLE} (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			digest TEXT NOT NULL,
			imported_at INTEGER NOT NULL
		)
	`);
}

async function seedSource(database: SqlDatabase): Promise<void> {
	await database.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
		["7001", "source_user", "Source User", 1_000_000, 1_000_000],
	);
	await database.execute(
		"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, ?, NULL, NULL, 'one_shot', ?, NULL, NULL)",
		["a".repeat(64), "7001", "profile.open", 1_001_000],
	);
}

describe("CF1-08 verified SQLite state transfer", () => {
	it("round-trips an ordered manifest and rejects tampering/repeat import", async () => {
		await withFreshMigratedDatabase({ prefix: "collaboration-cf1-08-source-", clock }, async (source) => {
			await seedSource(source.boundary);
			const manifest = await exportStateTransferManifest(source.boundary);

			await withFreshMigratedDatabase({ prefix: "collaboration-cf1-08-target-", clock }, async (target) => {
				await prepareAuditTable(target.boundary);
				await expect(importStateTransferManifest(target.boundary, manifest, () => 2_000_000)).resolves.toMatchObject({
					digest: manifest.digest,
					rowCount: 2,
					tableCount: 25,
				});
				expect((await exportStateTransferManifest(target.boundary)).digest).toBe(manifest.digest);
				expect(await target.boundary.query("SELECT telegram_user_id, display_name FROM telegram_users")).toEqual([{ telegram_user_id: "7001", display_name: "Source User" }]);

				await expect(importStateTransferManifest(target.boundary, manifest)).rejects.toBeInstanceOf(StateTransferConflictError);
				const tampered = { ...manifest, digest: "0".repeat(64) };
				await expect(importStateTransferManifest(target.boundary, tampered)).rejects.toBeInstanceOf(StateTransferValidationError);
			});
		});
	});

	it("rolls back every row when a later table insert fails", async () => {
		await withFreshMigratedDatabase({ prefix: "collaboration-cf1-08-rollback-source-", clock }, async (source) => {
			await seedSource(source.boundary);
			const manifest = await exportStateTransferManifest(source.boundary);
			await withFreshMigratedDatabase({ prefix: "collaboration-cf1-08-rollback-target-", clock }, async (target) => {
				await prepareAuditTable(target.boundary);
				let failed = false;
				const failingDatabase: SqlDatabase = {
					query: (sql, parameters) => target.boundary.query(sql, parameters),
					execute: (sql, parameters) => {
						if (!failed && sql.startsWith('INSERT INTO "telegram_actions"')) {
							failed = true;
							return Promise.reject(new Error("synthetic transfer interruption"));
						}
						return target.boundary.execute(sql, parameters);
					},
					withTransaction: (work) => target.boundary.withTransaction(work),
				};
				await expect(importStateTransferManifest(failingDatabase, manifest)).rejects.toThrow("synthetic transfer interruption");
				expect(await target.boundary.query("SELECT count(*) AS count FROM telegram_users")).toEqual([{ count: 0 }]);
				expect(await target.boundary.query(`SELECT count(*) AS count FROM ${STATE_TRANSFER_AUDIT_TABLE}`)).toEqual([{ count: 0 }]);
			});
		});
	});
});
