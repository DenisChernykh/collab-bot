import { describe, expect, it, vi } from "vitest";

import {
	parseRelayConfig,
	runTelegramRelay,
	type RelayConfigInput,
} from "../../src/cli/cloudflare-relay.js";

const validInput = (): RelayConfigInput => ({
	RELAY_BOT_TOKEN: "development-bot-token",
	LOCAL_WORKER_URL: "http://127.0.0.1:8787",
	TELEGRAM_WEBHOOK_SECRET: "development-webhook-secret",
});

describe("CF1-09 local Telegram relay", () => {
	it("requires a separate development token and validates the local Worker URL", () => {
		expect(parseRelayConfig(validInput())).toEqual({
			botToken: "development-bot-token",
			workerUrl: "http://127.0.0.1:8787",
			webhookSecret: "development-webhook-secret",
			pollTimeoutSeconds: 25,
			retryDelayMs: 1_000,
		});
		expect(() => parseRelayConfig({ ...validInput(), RELAY_BOT_TOKEN: undefined })).toThrow(/RELAY_BOT_TOKEN/);
		expect(() => parseRelayConfig({ ...validInput(), LOCAL_WORKER_URL: "/relative" })).toThrow(/LOCAL_WORKER_URL/);
		expect(() => parseRelayConfig({ ...validInput(), LOCAL_WORKER_URL: "https://remote.example" })).toThrow(/loopback/);
	});

	it("forwards raw updates sequentially and advances offset only after a 204", async () => {
		const controller = new AbortController();
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
			requests.push({ url: String(input), ...(init === undefined ? {} : { init }) });
			if (requests.length === 1) {
				return new Response(JSON.stringify({ ok: true, result: [
					{ update_id: 41, message: { text: "/start", chat: { id: 7001 } } },
					{ update_id: 42, callback_query: { id: "callback-42" } },
				] }), { headers: { "content-type": "application/json" } });
			}
			if (requests.length === 2) return new Response(null, { status: 204 });
			if (requests.length === 3) return new Response(null, { status: 204 });
			controller.abort();
			return new Response(JSON.stringify({ ok: true, result: [] }), { headers: { "content-type": "application/json" } });
		});

		await runTelegramRelay(
			parseRelayConfig(validInput()),
			{ fetch: fetcher, sleep: vi.fn(async () => undefined), log: vi.fn() },
			controller.signal,
		);

		expect(requests).toHaveLength(4);
		expect(requests[0]?.url).toContain("/botdevelopment-bot-token/getUpdates?");
		expect(requests[1]?.url).toContain("http://127.0.0.1:8787/telegram/webhook");
		expect(requests[2]?.url).toContain("http://127.0.0.1:8787/telegram/webhook");
		expect(requests[3]?.url).toContain("offset=43");
		expect(requests[0]?.init?.method).toBe("GET");
		expect(requests[1]?.init?.headers).toEqual({
			"content-type": "application/json",
			"x-telegram-bot-api-secret-token": "development-webhook-secret",
		});
		expect(requests[1]?.init?.body).toBe(JSON.stringify({ update_id: 41, message: { text: "/start", chat: { id: 7001 } } }));
		expect(requests[2]?.init?.body).toBe(JSON.stringify({ update_id: 42, callback_query: { id: "callback-42" } }));
	});
});
