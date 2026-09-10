/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../../src/worker.js";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { exportStateTransferManifest } from "../../src/platform/database/state-transfer.js";

it("protects a data-free state summary, preserves canonical hashes and never schedules delivery", async () => {
	const runtime = { COLLABORATION_STATE: env.COLLABORATION_STATE, OPERATIONS_TOKEN: "synthetic-summary-token", DEPLOYMENT_ENVIRONMENT: "staging" } as unknown as Env;
	const url = "https://staging.example/ops/state/summary";
	const headers = { authorization: "Bearer synthetic-summary-token" };
	expect((await worker.fetch(new Request(url), runtime)).status).toBe(401);
	expect((await worker.fetch(new Request(url, { headers, method: "POST" }), runtime)).status).toBe(405);
	const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("collaboration-bot-primary"));
	expect(await (await stub.fetch("https://local/__cf1/schema")).json()).toMatchObject({ migrationCount: 16 });
	const before = await runInDurableObject(stub, async (_instance, state) => {
		const db = new CloudflareSqlDatabase(state.storage);
		await db.execute("INSERT INTO telegram_users (telegram_user_id, username, display_name, status, created_at, updated_at) VALUES ('123456789', 'private_synthetic_username', 'Private synthetic name', 'active', 1, 1)");
		return exportStateTransferManifest(db);
	});
	const response = await worker.fetch(new Request(url, { headers }), runtime);
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	const text = await response.text();
	const summary = JSON.parse(text);
	expect(summary).toEqual({ schemaVersion: 16, tableCount: 25, rowCount: 1, digest: before.digest,
		tables: before.tables.map(({ name, rowCount, digest }) => ({ name, rowCount, digest })), quiescent: true, alarmScheduledAt: null });
	for (const secret of ["123456789", "private_synthetic_username", "Private synthetic name", '"rows"', '"columns"', "synthetic-summary-token"]) expect(text).not.toContain(secret);
	await runInDurableObject(stub, async (_instance, state) => {
		const db = new CloudflareSqlDatabase(state.storage);
		expect(await exportStateTransferManifest(db)).toEqual(before);
		expect(await state.storage.getAlarm()).toBeNull();
		await db.execute("INSERT INTO command_receipts (command_id, source, input_hash, status, created_at) VALUES ('synthetic-running', 'operator', ?, 'in_progress', 1)", ["a".repeat(64)]);
	});
	expect(await (await worker.fetch(new Request(url, { headers }), runtime)).json()).toMatchObject({ rowCount: 2, quiescent: false, alarmScheduledAt: null });
	await runInDurableObject(stub, async (_instance, state) => {
		state.storage.sql.exec("UPDATE __app_migrations SET checksum = ? WHERE id = 16", "0".repeat(64));
	});
	const invalid = await worker.fetch(new Request(url, { headers }), runtime);
	expect(invalid.status).toBe(500);
	expect(await invalid.json()).toEqual({ error: "state_summary_unavailable" });
});
