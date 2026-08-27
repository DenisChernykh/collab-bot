import type { Context } from "grammy";
import { describe, expect, it } from "vitest";

import { routeTelegramText, type TelegramTextRouteHandlers } from "../../src/presentation/telegram/telegram-routing.js";

const ctx = {} as Context;

describe("R2-01 Telegram routing contract", () => {
	it("preserves moderation, start, help, collaboration and marketplace precedence", async () => {
		const events: string[] = [];
		const handlers: TelegramTextRouteHandlers = {
			routeModeration: async (_ctx, _userId, command) => { events.push(`moderation:${command}`); return false; },
			routeStart: async (_ctx, _userId, startParameter) => { events.push(`start:${startParameter}`); return startParameter !== ""; },
			renderMenu: async () => { events.push("menu"); },
			renderHelp: async () => { events.push("help"); },
			routeCollaboration: async (_ctx, _userId, command) => { events.push(`collaboration:${command}`); return command === "/cancel"; },
			routeMarketplace: async (_ctx, _userId, command) => { events.push(`marketplace:${command}`); return command === "/feed"; },
		};

		expect(await routeTelegramText(ctx, "100", "/start c_token", handlers)).toBe(true);
		expect(events).toEqual(["moderation:/start", "start:c_token"]);

		events.length = 0;
		expect(await routeTelegramText(ctx, "100", "/start", handlers)).toBe(true);
		expect(events).toEqual(["moderation:/start", "start:", "menu"]);

		events.length = 0;
		expect(await routeTelegramText(ctx, "100", "/help", handlers)).toBe(true);
		expect(events).toEqual(["moderation:/help", "help"]);

		events.length = 0;
		expect(await routeTelegramText(ctx, "100", "/cancel", handlers)).toBe(true);
		expect(events).toEqual(["moderation:/cancel", "collaboration:/cancel"]);

		events.length = 0;
		expect(await routeTelegramText(ctx, "100", "/feed", handlers)).toBe(true);
		expect(events).toEqual(["moderation:/feed", "collaboration:/feed", "marketplace:/feed"]);

		events.length = 0;
		expect(await routeTelegramText(ctx, "100", "profile value", handlers)).toBe(false);
		expect(events).toEqual(["moderation:profile", "collaboration:profile", "marketplace:profile"]);
	});
});
