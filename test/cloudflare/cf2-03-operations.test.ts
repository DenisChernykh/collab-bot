/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { StateTransferManifest, StateTransferSummary } from "../../src/platform/database/state-transfer.js";
import worker from "../../src/worker.js";

const OPERATIONS_TOKEN = "cf2-03-operations-token";
const PRIMARY_OBJECT_NAME = "collaboration-bot-primary";
const REHEARSAL_OBJECT_NAME = "collaboration-bot-cf2-03-rehearsal";
const AUTHORIZATION_HEADERS = { authorization: `Bearer ${OPERATIONS_TOKEN}` };

type RehearsalRoute = {
	readonly path: string;
	readonly init?: RequestInit;
};

const REHEARSAL_ROUTES: readonly RehearsalRoute[] = [
	{ path: "/ops/rehearsal/state/export" },
	{
		path: "/ops/rehearsal/state/import",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		},
	},
	{ path: "/ops/rehearsal/pitr/bookmark" },
];

function runtimeEnvironment(deploymentEnvironment: string | null = "staging"): Env {
	return {
		COLLABORATION_STATE: env.COLLABORATION_STATE,
		OPERATIONS_TOKEN,
		STATE_IMPORT_ENABLED: "false",
		...(deploymentEnvironment === null ? {} : { DEPLOYMENT_ENVIRONMENT: deploymentEnvironment }),
	} as unknown as Env;
}

function authorizedRequest(path: string, init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${OPERATIONS_TOKEN}`);
	return new Request(`https://staging.example${path}`, { ...init, headers });
}

describe("CF2-03 staging operations rehearsal", () => {
	it("protects every rehearsal route and fails closed outside explicit staging", async () => {
		for (const route of REHEARSAL_ROUTES) {
			const unauthorized = await worker.fetch(
				new Request(`https://staging.example${route.path}`, route.init),
				runtimeEnvironment(),
			);
			expect(unauthorized.status, route.path).toBe(401);
			expect(await unauthorized.json(), route.path).toEqual({ error: "unauthorized" });

			for (const deploymentEnvironment of [null, "production"] as const) {
				const unavailable = await worker.fetch(
					authorizedRequest(route.path, route.init),
					runtimeEnvironment(deploymentEnvironment),
				);
				expect(unavailable.status, `${route.path}:${deploymentEnvironment ?? "absent"}`).toBe(403);
				expect(await unavailable.json(), `${route.path}:${deploymentEnvironment ?? "absent"}`).toEqual({
					error: "rehearsal_unavailable",
				});
			}
		}
	});

	it("imports once into the fixed rehearsal object with canonical parity and leaves primary unchanged", async () => {
		const primary = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName(PRIMARY_OBJECT_NAME));
		expect((await primary.fetch("https://local/__cf1/state/export")).status).toBe(200);
		await runInDurableObject(primary, async (_instance, state) => {
			state.storage.sql.exec(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
				"23003",
				"cf2_rehearsal_source",
				"CF2 Rehearsal Source",
				3_000_000,
				3_000_000,
			).toArray();
			expect(await state.storage.getAlarm()).toBeNull();
		});

		const environment = runtimeEnvironment();
		const primaryBeforeResponse = await worker.fetch(
			new Request("https://staging.example/ops/state/export", { headers: AUTHORIZATION_HEADERS }),
			environment,
		);
		expect(primaryBeforeResponse.status).toBe(200);
		const primaryBefore = await primaryBeforeResponse.json() as StateTransferManifest;
		expect(primaryBefore.digest).toMatch(/^[0-9a-f]{64}$/u);

		const importedResponse = await worker.fetch(
			authorizedRequest("/ops/rehearsal/state/import", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(primaryBefore),
			}),
			environment,
		);
		expect(importedResponse.status).toBe(200);
		expect(await importedResponse.json() as StateTransferSummary).toEqual({
			digest: primaryBefore.digest,
			tableCount: 17,
			rowCount: 1,
		});

		const rehearsalExportResponse = await worker.fetch(
			authorizedRequest("/ops/rehearsal/state/export"),
			environment,
		);
		expect(rehearsalExportResponse.status).toBe(200);
		const rehearsalExport = await rehearsalExportResponse.json() as StateTransferManifest;
		expect(rehearsalExport.digest).toBe(primaryBefore.digest);
		expect(rehearsalExport.tables.map((table) => table.name)).not.toContain("cf1_state_import_audit");

		const repeatedResponse = await worker.fetch(
			authorizedRequest("/ops/rehearsal/state/import", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(primaryBefore),
			}),
			environment,
		);
		expect(repeatedResponse.status).toBe(409);
		expect(await repeatedResponse.json()).toEqual({ error: "state_import_conflict" });

		const primaryAfterResponse = await worker.fetch(
			new Request("https://staging.example/ops/state/export", { headers: AUTHORIZATION_HEADERS }),
			environment,
		);
		expect(primaryAfterResponse.status).toBe(200);
		expect((await primaryAfterResponse.json() as StateTransferManifest).digest).toBe(primaryBefore.digest);
		await runInDurableObject(primary, async (_instance, state) => {
			expect(state.storage.sql.exec("SELECT count(*) AS count FROM cf1_state_import_audit").toArray()).toEqual([{ count: 0 }]);
			expect(await state.storage.getAlarm()).toBeNull();
		});

		const rehearsal = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName(REHEARSAL_OBJECT_NAME));
		await runInDurableObject(rehearsal, async (_instance, state) => {
			expect(state.storage.sql.exec("SELECT digest FROM cf1_state_import_audit WHERE id = 1").toArray()).toEqual([
				{ digest: primaryBefore.digest },
			]);
			expect(await state.storage.getAlarm()).toBeNull();
		});

		for (const route of ["/ops/rehearsal/ready", "/ops/rehearsal/update"] as const) {
			const response = await worker.fetch(
				authorizedRequest(route, route.endsWith("/update") ? { method: "POST", body: "{}" } : {}),
				environment,
			);
			expect(response.status, route).toBe(404);
			expect(await response.json(), route).toEqual({ error: "not_found" });
		}
	});

	it("returns a nonempty PITR bookmark or the explicit local-runtime fallback without scheduling an alarm", async () => {
		const environment = runtimeEnvironment();
		const response = await worker.fetch(
			authorizedRequest("/ops/rehearsal/pitr/bookmark"),
			environment,
		);

		if (response.status === 200) {
			expect(await response.json()).toEqual({ bookmark: expect.stringMatching(/\S+/u) });
		} else {
			expect(response.status).toBe(501);
			expect(await response.json()).toEqual({ error: "pitr_bookmark_unavailable" });
		}

		const rehearsal = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName(REHEARSAL_OBJECT_NAME));
		await runInDurableObject(rehearsal, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});
});
