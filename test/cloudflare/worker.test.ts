/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("local Cloudflare runtime harness", () => {
	it("serves a liveness response from the Worker", async () => {
		const response = await exports.default.fetch(new Request("http://local/health/live"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok", runtime: "cloudflare-local" });
	});

	it("boots the named singleton SQLite Durable Object", async () => {
		const objectId = env.COLLABORATION_STATE.idFromName("collaboration-bot-primary");
		const response = await env.COLLABORATION_STATE.get(objectId).fetch(
			new Request("http://local/__cf1/smoke"),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			durableObject: "CollaborationBotState",
			storage: "ready",
		});
	});
});
