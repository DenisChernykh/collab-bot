/// <reference types="@cloudflare/vitest-plugin/types" />

import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { handleTelegramWebhook } from "../../src/runtime/cloudflare/webhook.js";

const request = (body: string, secret = "webhook-secret"): Request => new Request("https://local/telegram/webhook", {
	method: "POST",
	headers: {
		"content-type": "application/json",
		"x-telegram-bot-api-secret-token": secret,
	},
	body,
});

describe("CF1-06 Telegram webhook contract", () => {
	it("returns 405 for non-POST and 415 for non-JSON ingress", async () => {
		expect((await exports.default.fetch(new Request("https://local/telegram/webhook"))).status).toBe(405);
		expect((await exports.default.fetch(new Request("https://local/telegram/webhook", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: "{}",
		}))).status).toBe(415);
	});

	it("requires the secret before dispatching an otherwise valid JSON body", async () => {
		const response = await exports.default.fetch(new Request("https://local/telegram/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ update_id: 1 }),
		}));

		expect(response.status).toBe(401);
	});

	it("keeps operational diagnostics protected", async () => {
		expect((await exports.default.fetch(new Request("https://local/ops/ready"))).status).toBe(401);
		expect((await exports.default.fetch(new Request("https://local/ops/state/export"))).status).toBe(401);
		expect((await exports.default.fetch(new Request("https://local/ops/state/import", { method: "POST" }))).status).toBe(401);
	});

	it("parses a valid update, enforces size and maps handler failures", async () => {
		const dispatch = vi.fn(async () => undefined);
		const accepted = await handleTelegramWebhook(request(JSON.stringify({ update_id: 42 })), "webhook-secret", dispatch);
		expect(accepted.status).toBe(204);
		expect(dispatch).toHaveBeenCalledWith({ update_id: 42 });

		const malformed = await handleTelegramWebhook(request("{invalid"), "webhook-secret", dispatch);
		expect(malformed.status).toBe(400);

		const oversized = await handleTelegramWebhook(request(JSON.stringify({ update_id: 43, payload: "x".repeat(1_048_576) })), "webhook-secret", dispatch);
		expect(oversized.status).toBe(413);

		const failed = await handleTelegramWebhook(request(JSON.stringify({ update_id: 44 })), "webhook-secret", async () => {
			throw new Error("handler failure");
		});
		expect(failed.status).toBe(500);
	});
});
