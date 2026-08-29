/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../../src/worker.js";

const OPERATIONS_TOKEN = "cf3-01-operations-token";
const PRIMARY_OBJECT_NAME = "collaboration-bot-primary";

function runtimeEnvironment(deploymentEnvironment: "production" | "staging"): Env {
	return {
		COLLABORATION_STATE: env.COLLABORATION_STATE,
		OPERATIONS_TOKEN,
		DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
	} as unknown as Env;
}

function authorizedRequest(init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${OPERATIONS_TOKEN}`);
	return new Request("https://production.example/ops/pitr/bookmark", { ...init, headers });
}

describe("CF3-01 production operations", () => {
	it("protects the primary PITR route and fails closed outside production", async () => {
		const unauthorized = await worker.fetch(
			new Request("https://production.example/ops/pitr/bookmark"),
			runtimeEnvironment("production"),
		);
		expect(unauthorized.status).toBe(401);
		expect(await unauthorized.json()).toEqual({ error: "unauthorized" });

		const staging = await worker.fetch(authorizedRequest(), runtimeEnvironment("staging"));
		expect(staging.status).toBe(403);
		expect(await staging.json()).toEqual({ error: "pitr_unavailable" });
	});

	it("captures a primary bookmark without scheduling delivery", async () => {
		const response = await worker.fetch(authorizedRequest(), runtimeEnvironment("production"));

		if (response.status === 200) {
			expect(await response.json()).toEqual({ bookmark: expect.stringMatching(/\S+/u) });
		} else {
			expect(response.status).toBe(501);
			expect(await response.json()).toEqual({ error: "pitr_bookmark_unavailable" });
		}

		const primary = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName(PRIMARY_OBJECT_NAME));
		await runInDurableObject(primary, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});
});
