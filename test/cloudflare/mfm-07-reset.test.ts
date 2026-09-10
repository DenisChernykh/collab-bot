/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import resetWorker, { CollaborationBotState as ResetState } from "../../src/reset-worker.js";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { inspectProjectReset, type ResetInspection } from "../../src/platform/database/project-reset.js";

it("fails closed outside the authenticated maintenance surface", async () => {
	const runtime = { COLLABORATION_STATE: env.COLLABORATION_STATE, DEPLOYMENT_ENVIRONMENT: "production", OPERATIONS_TOKEN: "synthetic-operations", RESET_OPERATION_ID: "mfm-2026-reset" };
	expect((await resetWorker.fetch(new Request("https://local/telegram/webhook", { method: "POST" }), runtime)).status).toBe(503);
	expect((await resetWorker.fetch(new Request("https://local/ops/reset/apply", { method: "POST" }), runtime)).status).toBe(401);
	expect((await resetWorker.fetch(new Request("https://local/ops/reset/rehearsal/apply", { method: "POST", headers: { authorization: "Bearer synthetic-operations" } }), runtime)).status).toBe(404);
	expect((await resetWorker.fetch(new Request("https://local/ops/reset/inspect", { headers: { authorization: "Bearer synthetic-operations" } }), { ...runtime, RESET_OPERATION_ID: "" })).status).toBe(403);
});

it("resets the same DO storage atomically with append-only guards restored and a durable retry result", async () => {
	const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("mfm-07-reset"));
	await stub.fetch("https://local/__cf1/schema");
	await runInDurableObject(stub, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		await state.storage.setAlarm(Date.now() + 600_000);
		await state.storage.deleteAlarm();
		expect(await database.query("SELECT name FROM sqlite_master WHERE name = '_cf_METADATA'")).toHaveLength(1);
		const runtime = { COLLABORATION_STATE: env.COLLABORATION_STATE, DEPLOYMENT_ENVIRONMENT: "staging", RESET_OPERATION_ID: "mfm-2026-reset" };
		const helper = new ResetState(state, runtime);
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('1', 'Synthetic', 'active', 1, 1)");
		const insertEvent = () => database.execute("INSERT INTO product_events (event_id, event_type, idempotency_key, safe_attributes_json, occurred_at) VALUES ('00000000-0000-4000-8000-000000000001', 'bot_started', 'reset-test', '{}', 1)");
		await insertEvent();
		const inspect = () => helper.fetch(new Request("https://local/inspect"));
		await inspectProjectReset(database, "synthetic:inspection");
		const inspection = await inspect();
		const before = await inspection.json() as ResetInspection;
		expect(inspection.status, JSON.stringify({ body: before, tables: await database.query("SELECT name FROM sqlite_master WHERE type = 'table'") })).toBe(200);
		const body = { operationId: runtime.RESET_OPERATION_ID, target: before.target, expectedDigest: before.digest };
		const request = () => new Request("https://local/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		await database.execute("CREATE TRIGGER reset_failure BEFORE DELETE ON telegram_users BEGIN SELECT RAISE(ABORT, 'synthetic reset failure'); END");
		const guarded = await (await inspect()).json() as ResetInspection;
		body.expectedDigest = guarded.digest;
		expect((await helper.fetch(request())).status).toBe(409);
		expect(await (await inspect()).json()).toEqual(guarded);
		await database.execute("DROP TRIGGER reset_failure");
		body.expectedDigest = before.digest;
		const response = await helper.fetch(request());
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result).toMatchObject({ removedRows: 2, schemaVersion: 16 });
		expect(await (await inspect()).json()).toMatchObject({ rowCount: 0, schemaDigest: before.schemaDigest });
		await insertEvent();
		await expect(database.execute("DELETE FROM product_events")).rejects.toThrow("append-only");
		expect(await (await new ResetState(state, runtime).fetch(request())).json()).toEqual(result);
		expect(await database.query("SELECT count(*) AS count FROM product_events")).toEqual([{ count: 1 }]);
		expect(await state.storage.getAlarm()).toBeNull();
		expect(await database.query("SELECT name FROM sqlite_master WHERE name = '_cf_METADATA'")).toHaveLength(1);
	});
});
