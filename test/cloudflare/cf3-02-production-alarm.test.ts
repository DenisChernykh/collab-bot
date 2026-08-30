/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../../src/worker.js";

const OPERATIONS_TOKEN = "cf3-02-operations-token";
const PRIMARY_OBJECT_NAME = "collaboration-bot-primary";
const SCHEDULED_AT = 2_000_000_000_000;

function runtimeEnvironment(deploymentEnvironment: "production" | "staging"): Env {
	return {
		COLLABORATION_STATE: env.COLLABORATION_STATE,
		OPERATIONS_TOKEN,
		DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
	} as unknown as Env;
}

function authorizedRequest(): Request {
	return new Request("https://production.example/ops/alarm", {
		headers: { authorization: `Bearer ${OPERATIONS_TOKEN}` },
	});
}

describe("CF3-02 production alarm inspection", () => {
	it("protects the read-only alarm route and fails closed outside production", async () => {
		const unauthorized = await worker.fetch(
			new Request("https://production.example/ops/alarm"),
			runtimeEnvironment("production"),
		);
		expect(unauthorized.status).toBe(401);
		expect(await unauthorized.json()).toEqual({ error: "unauthorized" });

		const staging = await worker.fetch(authorizedRequest(), runtimeEnvironment("staging"));
		expect(staging.status).toBe(403);
		expect(await staging.json()).toEqual({ error: "alarm_unavailable" });
	});

	it("reads the fixed primary alarm without changing it", async () => {
		const primary = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName(PRIMARY_OBJECT_NAME));
		await runInDurableObject(primary, async (_instance, state) => {
			await state.storage.setAlarm(SCHEDULED_AT);
		});

		const response = await worker.fetch(authorizedRequest(), runtimeEnvironment("production"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ scheduledAt: SCHEDULED_AT });

		await runInDurableObject(primary, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBe(SCHEDULED_AT);
		});
	});
});
