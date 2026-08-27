import { InlineKeyboard, type Context } from "grammy";
import { describe, expect, it } from "vitest";

import {
	createMarketplaceTelegramFeature,
	parseMarketplaceCallback,
} from "../../src/modules/marketplace/index.js";

describe("R2-09A marketplace Telegram presentation", () => {
	it("claims only browse callbacks", () => {
		expect(parseMarketplaceCallback("browse:start")).toEqual({ kind: "open_feed" });
		expect(parseMarketplaceCallback("b:n:0123456789abcdef:z")).toEqual({
			kind: "browse",
			mutation: { kind: "next", generation: "0123456789abcdef", revision: 35 },
		});
		expect(parseMarketplaceCallback("application:own")).toBeUndefined();
		expect(parseMarketplaceCallback(`application:start:d:${"A".repeat(22)}`)).toBeUndefined();
		expect(parseMarketplaceCallback("profile:view")).toBeUndefined();
		expect(parseMarketplaceCallback("collaboration:own")).toBeUndefined();
		expect(parseMarketplaceCallback("cb_opaque")).toBeUndefined();
	});

	it("keeps malformed collaboration deep links claimed while generic start remains available", async () => {
		const replies: string[] = [];
		const feature = createMarketplaceTelegramFeature({
			browseService: {
				openDeepLink: async () => ({ kind: "unavailable" }),
			} as never,
			menuKeyboard: () => new InlineKeyboard().text("Menu", "menu:home"),
			applicationStartCallback: (source, token) => `application:start:${source === "feed" ? "f" : "d"}:${token}`,
		});
		const ctx = { reply: async (text: string) => { replies.push(text); } } as unknown as Context;

		expect(await feature.routeStart(ctx, "100", "")).toBe(false);
		expect(await feature.routeStart(ctx, "100", "c_short")).toBe(true);
		expect(replies).toEqual(["Предложение недоступно."]);
	});

	it("resolves a valid application target without sending a duplicate card", async () => {
		const replies: string[] = [];
		const feature = createMarketplaceTelegramFeature({
			browseService: {
				openDeepLink: async () => ({ kind: "card", card: { id: "collaboration-1" }, actionable: true }),
			} as never,
			menuKeyboard: () => new InlineKeyboard().text("Menu", "menu:home"),
			applicationStartCallback: (source, token) => `application:start:${source === "feed" ? "f" : "d"}:${token}`,
		});
		const ctx = { reply: async (text: string) => { replies.push(text); } } as unknown as Context;

		expect(await feature.resolveApplicationTarget(ctx, "100", "A".repeat(22))).toEqual({
			kind: "card",
			collaborationId: "collaboration-1",
		});
		expect(replies).toEqual([]);
	});
});
