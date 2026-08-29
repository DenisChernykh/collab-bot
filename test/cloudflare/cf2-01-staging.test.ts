/// <reference types="@cloudflare/vitest-plugin/types" />

import { describe, expect, it } from "vitest";

import worker from "../../src/worker.js";

describe("CF2-01 hosted staging boundary", () => {
	it("reports the explicit Cloudflare deployment environment without touching the Durable Object", async () => {
		const response = await worker.fetch(
			new Request("https://staging.example/health/live"),
			{ DEPLOYMENT_ENVIRONMENT: "staging" } as unknown as Env,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "ok",
			runtime: "cloudflare",
			environment: "staging",
		});
	});

	it("fails hosted readiness closed before every Telegram identity binding is configured", async () => {
		const response = await worker.fetch(
			new Request("https://staging.example/ops/ready", {
				headers: { authorization: "Bearer staging-operations-token" },
			}),
			{
				DEPLOYMENT_ENVIRONMENT: "staging",
				OPERATIONS_TOKEN: "staging-operations-token",
			} as unknown as Env,
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			status: "not_ready",
			reason: "preflight_configuration_incomplete",
		});
	});
});
