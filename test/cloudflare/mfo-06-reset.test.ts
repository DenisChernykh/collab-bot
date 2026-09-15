/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import type { ResetInspection, ResetRequest } from "../../src/platform/database/project-reset.js";
import { CollaborationBotState as ResetState } from "../../src/reset-worker.js";
import { connectionProfileId, seedConnectionPerson } from "../support/connections-fixture.js";

it("runs the third primary reset through the maintenance Durable Object and keeps exact retry harmless", async () => {
	const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("mfo-third-reset"));
	expect(await (await stub.fetch("https://local/__cf1/schema")).json()).toMatchObject({ migrationCount: 19 });
	await runInDurableObject(stub, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		const runtime = { COLLABORATION_STATE: env.COLLABORATION_STATE, DEPLOYMENT_ENVIRONMENT: "staging" };
		const helper = (operationId: string) => new ResetState(state, { ...runtime, RESET_OPERATION_ID: operationId });
		const inspect = async () => (await helper("mfo-2026-reset").fetch(new Request("https://local/inspect"))).json() as Promise<ResetInspection>;
		const apply = (operationId: string, body: ResetRequest) => helper(operationId).fetch(new Request("https://local/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
		for (const operationId of ["mfm-2026-reset", "mnet-2026-reset"]) {
			const before = await inspect();
			expect((await apply(operationId, { operationId, target: before.target, expectedDigest: before.digest })).status).toBe(200);
		}
		await seedConnectionPerson(database, 1);
		await database.execute("INSERT INTO mfm_profile_contacts (profile_id, kind, url, username, telegram_chat_id, title, updated_at) VALUES (?, 'telegram_channel', 'https://t.me/public_channel', 'public_channel', '-100300', 'Public channel', 1)", [connectionProfileId(1)]);
		const before = await inspect();
		const request = { operationId: "mfo-2026-reset", target: before.target, expectedDigest: before.digest };
		const response = await apply(request.operationId, request);
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result).toMatchObject({ operationId: request.operationId, removedRows: before.rowCount, schemaVersion: 19 });
		expect(await inspect()).toMatchObject({ rowCount: 0, completedOperations: expect.arrayContaining([expect.objectContaining({ operationId: "mfm-2026-reset" }), expect.objectContaining({ operationId: "mnet-2026-reset" }), result]) });
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('2', 'Later', 'active', 2, 2)");
		expect(await (await apply(request.operationId, request)).json()).toEqual(result);
		expect(await database.query("SELECT telegram_user_id FROM telegram_users")).toEqual([{ telegram_user_id: "2" }]);
	});
});
