import { CURRENT_SCHEMA_VERSION } from "../support/canonical-migrations.js";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";
import { expect, it } from "vitest";
import { inspectProjectReset, resetProjectDatabase } from "../../src/platform/database/project-reset.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { FakeClock } from "../support/fake-clock.js";

it("requires the exact target and digest, clears data once and preserves the schema and later data", async () => {
	await withFreshMigratedDatabase({ prefix: "mfm-reset-", clock: new FakeClock(100) }, async ({ boundary }) => {
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('1', 'Synthetic', 'active', 1, 1)");
		const before = await inspectProjectReset(boundary, "local:test");
		const request = { operationId: "mfm-2026-reset", target: before.target, expectedDigest: before.digest };
		await expect(resetProjectDatabase(boundary, "local:other", request)).rejects.toThrow("reset_target_mismatch");
		await expect(resetProjectDatabase(boundary, "local:test", { ...request, expectedDigest: "a".repeat(64) })).rejects.toThrow("reset_digest_mismatch");
		const result = await resetProjectDatabase(boundary, "local:test", request);
		expect(result).toMatchObject({ target: "local:test", removedRows: 1, beforeDigest: before.digest, schemaVersion: CURRENT_SCHEMA_VERSION });
		expect((await inspectProjectReset(boundary, "local:test")).rowCount).toBe(0);
		expect(await boundary.query("SELECT count(*) AS count FROM __app_migrations")).toEqual([{ count: CURRENT_SCHEMA_VERSION }]);
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('2', 'After reset', 'active', 2, 2)");
		expect(await resetProjectDatabase(boundary, "local:test", request)).toEqual(result);
		expect((await inspectProjectReset(boundary, "local:test")).rowCount).toBe(1);
		await expect(resetProjectDatabase(boundary, "local:test", { ...request, operationId: "second-reset" })).rejects.toThrow("reset_already_completed");
	});
});

it("rolls back every delete and restores append-only guards on a failure", async () => {
	await withFreshMigratedDatabase({ prefix: "mfm-reset-rollback-", clock: new FakeClock(100) }, async ({ boundary }) => {
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('1', 'Synthetic', 'active', 1, 1)");
		await boundary.execute("CREATE TRIGGER injected_reset_failure BEFORE DELETE ON telegram_users BEGIN SELECT RAISE(ABORT, 'injected reset failure'); END");
		const before = await inspectProjectReset(boundary, "local:test");
		await expect(resetProjectDatabase(boundary, "local:test", { operationId: "mfm-2026-reset", target: before.target, expectedDigest: before.digest })).rejects.toThrow("injected reset failure");
		expect(await inspectProjectReset(boundary, "local:test")).toEqual(before);
		expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('product_events_append_only_delete', 'operator_actions_append_only_delete')")).toHaveLength(2);
	});
});

it("refuses unreviewed tables and nonterminal delivery state", async () => {
	await withFreshMigratedDatabase({ prefix: "mfm-reset-guard-", clock: new FakeClock(100) }, async ({ boundary }) => {
		await boundary.execute("INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, payload_json, status, attempt_count, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'reset-test', 'dm_send', '1', '{}', 'prepared', 0, 1, 1)");
		const before = await inspectProjectReset(boundary, "local:test");
		expect(before.quiescent).toBe(false);
		await expect(resetProjectDatabase(boundary, "local:test", { operationId: "mfm-2026-reset", target: before.target, expectedDigest: before.digest })).rejects.toThrow("reset_delivery_not_quiescent");
		await boundary.execute("CREATE TABLE unknown_project_data (id INTEGER PRIMARY KEY)");
		await expect(inspectProjectReset(boundary, "local:test")).rejects.toMatchObject({ message: "reset_unreviewed_table", tableNames: ["unknown_project_data"] });
	});
});

it.each([11, 13])("clears populated legacy schema %i without migrating or weakening its guards", async (version) => {
	const directory = await mkdtemp(join(tmpdir(), "mfm-legacy-reset-"));
	const database = new DatabaseBoundary(join(directory, "app.sqlite"));
	try {
		const previous = join(directory, "migrations"); await mkdir(previous);
		for (const name of await readdir("migrations")) if (Number(name.slice(0, 4)) <= version) await copyFile(join("migrations", name), join(previous, name));
		const runner = new MigrationRunner(await MigrationSource.fromDirectory(previous)); await runner.migrate(database);
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('1', 'Synthetic', 'active', 1, 1)");
		await database.execute("INSERT INTO product_events (event_id, event_type, idempotency_key, safe_attributes_json, occurred_at) VALUES ('00000000-0000-4000-8000-000000000001', 'bot_started', 'reset-test', '{}', 1)");
		const before = await inspectProjectReset(database, "local:legacy");
		const result = await resetProjectDatabase(database, "local:legacy", { operationId: "mfm-2026-reset", target: before.target, expectedDigest: before.digest });
		expect(result).toMatchObject({ removedRows: 2, schemaVersion: version });
		expect((await inspectProjectReset(database, "local:legacy")).rowCount).toBe(0);
		await runner.verify(database);
	} finally { await database.close(); await rm(directory, { recursive: true, force: true }); }
});
