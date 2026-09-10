/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { CollaborationBotState as ResetState } from "../../src/reset-worker.js";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import type { ResetInspection, ResetRequest } from "../../src/platform/database/project-reset.js";

it("performs two separately enabled workerd resets, preserving prior audit and rejecting active alarms or changed retry input", async () => {
	const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("mnet-second-reset"));
	expect(await (await stub.fetch("https://local/__cf1/schema")).json()).toMatchObject({ migrationCount: 17 });
	await runInDurableObject(stub, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		const runtime = { COLLABORATION_STATE: env.COLLABORATION_STATE, DEPLOYMENT_ENVIRONMENT: "staging" };
		const first = new ResetState(state, { ...runtime, RESET_OPERATION_ID: "mfm-2026-reset" });
		const second = new ResetState(state, { ...runtime, RESET_OPERATION_ID: "mnet-2026-reset" });
		const inspect = async () => (await second.fetch(new Request("https://local/inspect"))).json() as Promise<ResetInspection>;
		const request = (body: ResetRequest) => new Request("https://local/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		const initial = await inspect();
		const firstRequest = { operationId: "mfm-2026-reset", target: initial.target, expectedDigest: initial.digest };
		const firstResponse = await first.fetch(request(firstRequest)); expect(firstResponse.status).toBe(200);
		const firstResult = await firstResponse.json();
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('1', 'Synthetic', 'active', 1, 1)");
		const before = await inspect();
		const secondRequest = { operationId: "mnet-2026-reset", target: before.target, expectedDigest: before.digest };
		expect((await first.fetch(request(secondRequest))).status).toBe(400);
		await state.storage.setAlarm(Date.now() + 600_000);
		expect(await (await second.fetch(request(secondRequest))).json()).toEqual({ error: "reset_alarm_not_quiescent" });
		await state.storage.deleteAlarm();
		await database.execute("CREATE TRIGGER second_reset_failure BEFORE DELETE ON telegram_users BEGIN SELECT RAISE(ABORT, 'injected reset failure'); END");
		const guarded = await inspect();
		expect((await second.fetch(request({ ...secondRequest, expectedDigest: guarded.digest }))).status).toBe(409);
		expect(await inspect()).toEqual(guarded);
		await database.execute("DROP TRIGGER second_reset_failure");
		// setAlarm creates Cloudflare-owned metadata, so inspect again after removing the failure guard.
		const ready = await inspect(); secondRequest.expectedDigest = ready.digest;
		const response = await second.fetch(request(secondRequest)); expect(response.status).toBe(200);
		const result = await response.json();
		expect(result).toMatchObject({ operationId: "mnet-2026-reset", removedRows: 1, schemaVersion: 17 });
		expect(await inspect()).toMatchObject({ rowCount: 0, schemaDigest: ready.schemaDigest, completedOperations: [firstResult, result] });
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('2', 'Later synthetic', 'active', 1, 1)");
		const later = await inspect();
		expect(await (await first.fetch(request(firstRequest))).json()).toEqual(firstResult);
		expect(await (await new ResetState(state, { ...runtime, RESET_OPERATION_ID: "mnet-2026-reset" }).fetch(request(secondRequest))).json()).toEqual(result);
		expect(await inspect()).toEqual(later);
		expect(await (await second.fetch(request({ ...secondRequest, expectedDigest: later.digest }))).json()).toEqual({ error: "reset_already_completed" });
		expect(await database.query("PRAGMA foreign_key_check")).toEqual([]);
		expect(await state.storage.getAlarm()).toBeNull();
	});
});
