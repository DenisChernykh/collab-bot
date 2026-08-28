/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { CollaborationBotState } from "../../src/worker.js";
import { CloudflareMigrationRunner } from "../../src/platform/database/cloudflare-migrations.js";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { CLOUDFLARE_MIGRATION_MANIFEST } from "../../src/platform/database/cloudflare-migration-manifest.js";

const singleton = () => env.COLLABORATION_STATE.get(
	env.COLLABORATION_STATE.idFromName("cf1-05-schema-contract"),
);

describe("CF1-05 Durable Object SQLite contract", () => {
	it("boots the canonical 13-migration schema and reopens it after eviction", async () => {
		const stub = singleton();
		const first = await stub.fetch("https://local/__cf1/schema");

		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({
			migrationCount: 13,
			historyTable: "__app_migrations",
			integrity: "ok",
		});

		await runInDurableObject(stub, async (instance, state) => {
			expect(instance).toBeInstanceOf(CollaborationBotState);
			const rows = state.storage.sql
				.exec<{ count: number }>("SELECT count(*) AS count FROM __app_migrations")
				.toArray();
			expect(rows).toEqual([{ count: 13 }]);
		});

		await evictDurableObject(stub);
		const reopened = await stub.fetch("https://local/__cf1/schema");
		expect(reopened.status).toBe(200);
		expect(await reopened.json()).toEqual({
			migrationCount: 13,
			historyTable: "__app_migrations",
			integrity: "ok",
		});
	});

	it("keeps nested failures rollback-only and leaves no partial rows", async () => {
		const stub = env.COLLABORATION_STATE.get(
			env.COLLABORATION_STATE.idFromName("cf1-05-nested-rollback"),
		);

		await runInDurableObject(stub, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			await database.execute("CREATE TABLE contract_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");

			await expect(
				database.withTransaction(async () => {
					await database.execute("INSERT INTO contract_rows (id, value) VALUES (?, ?)", [1, "outer"]);
					try {
						await database.withTransaction(async () => {
							await database.execute("INSERT INTO contract_rows (id, value) VALUES (?, ?)", [2, "nested"]);
							throw new Error("nested failure");
						});
					} catch (error) {
						expect(error).toEqual(new Error("nested failure"));
					}
					await database.execute("INSERT INTO contract_rows (id, value) VALUES (?, ?)", [3, "after"]);
				}),
			).rejects.toThrow("transaction marked rollback-only");

			expect(await database.query("SELECT id, value FROM contract_rows ORDER BY id")).toEqual([]);
		});
	});

	it("fails closed when a bundled migration is tampered with", async () => {
		const stub = singleton();
		await runInDurableObject(stub, async (_instance, state) => {
			const database = new CloudflareSqlDatabase(state.storage);
			const first = CLOUDFLARE_MIGRATION_MANIFEST[0];
			if (first === undefined) throw new Error("manifest is empty");

			const tampered = [{ ...first, sql: `${first.sql}\n-- tampered` }];
			await expect(new CloudflareMigrationRunner(database, tampered).verify()).rejects.toThrow(
				"cloudflare migration manifest checksum/order mismatch at 1",
			);
		});
	});
});
