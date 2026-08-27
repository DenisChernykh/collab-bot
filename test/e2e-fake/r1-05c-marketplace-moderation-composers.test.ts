import { Bot, Composer, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe, Update } from "grammy/types";
import { describe, expect, it, vi } from "vitest";

import type { CanonicalInput } from "../../src/application/commands/canonical-input.js";
import type { SafeResult } from "../../src/application/commands/safe-result.js";
import { createModerationTelegramFeature } from "../../src/modules/moderation/index.js";
import { FakeTelegramApi } from "../support/fake-telegram-api.js";
import { createApplicationsTelegramFeature, parseApplicationsCallback } from "../../src/modules/applications/index.js";
import { createMarketplaceTelegramFeature, parseMarketplaceCallback } from "../../src/modules/marketplace/index.js";

const NOW = 1_700_000_000_000;

describe("R1-05C marketplace and moderation Telegram composers", () => {
	it("claims only marketplace callbacks and lets one outer acknowledgement serve the handled route", async () => {
		expect(parseMarketplaceCallback("browse:start")).toEqual({ kind: "open_feed" });
		expect(parseMarketplaceCallback("b:n:0123456789abcdef:z")).toEqual({ kind: "browse", mutation: { kind: "next", generation: "0123456789abcdef", revision: 35 } });
		expect(parseApplicationsCallback(`application:start:d:${"A".repeat(22)}`)).toEqual({ kind: "start_application", start: { publicToken: "A".repeat(22), source: "deep_link" } });
		expect(parseApplicationsCallback("application:own")).toEqual({ kind: "own_applications" });
		expect(parseMarketplaceCallback("profile:view")).toBeUndefined();
		expect(parseMarketplaceCallback("collaboration:own")).toBeUndefined();
		expect(parseMarketplaceCallback("cb_opaque")).toBeUndefined();

		const fake = telegramFake();
		const feature = createApplicationsTelegramFeature({
			applicationsApi: applicationsApi({ listOwnApplications: async () => [] }),
			clock: { now: () => new Date(NOW) },
			menuKeyboard: () => new InlineKeyboard().text("Menu", "menu:home"),
			profileFlow: emptyProfileFlow(),
			targetFlow: emptyTargetFlow(),
			profileTypeLabel: String,
			topicLabel: String,
			upsertActorSnapshot: async () => {},
			occurredAt: () => new Date(NOW),
			getUpdateId: (ctx) => ctx.update.update_id,
		});
		let terminalCalls = 0;
		const root = new Composer<Context>();
		root.on("callback_query:data", async (ctx, next) => {
			await ctx.answerCallbackQuery();
			await next();
		});
		root.use(feature.composer);
		root.on("callback_query:data", () => { terminalCalls += 1; });
		const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
		bot.use(root);
		await bot.init();

		await bot.handleUpdate(callback(1, "application:own"));
		expect(fake.calls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
		expect(fake.calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
		expect(terminalCalls).toBe(0);
		await bot.handleUpdate(callback(2, "profile:view"));
		expect(terminalCalls).toBe(1);
	});

	it("keeps malformed collaboration deep links claimed while generic start remains available", async () => {
		const replies: string[] = [];
		const feature = createMarketplaceTelegramFeature({
			browseService: { openDeepLink: async () => ({ kind: "unavailable" }) } as never,
			menuKeyboard: () => new InlineKeyboard().text("Menu", "menu:home"),
			applicationStartCallback: (source, token) => `application:start:${source === "feed" ? "f" : "d"}:${token}`,
		});
		const ctx = { reply: async (text: string) => { replies.push(text); } } as unknown as Context;
		expect(await feature.routeStart(ctx, "100", "")).toBe(false);
		expect(await feature.routeStart(ctx, "100", "c_short")).toBe(true);
		expect(replies).toEqual(["Предложение недоступно."]);
	});

	it("keeps opaque callbacks actor-bound, outside the generic composer, and acknowledges a stale result once", async () => {
		const invokedActors: unknown[] = [];
		const feature = createApplicationsTelegramFeature({
			applicationsApi: applicationsApi(),
			callbackActionService: {
				invoke: async (request: { context: { actor: unknown } }): Promise<SafeResult> => {
					invokedActors.push(request.context.actor);
					return { version: 1, outcome: "stale", messageKey: "callback_stale" };
				},
			} as never,
			clock: { now: () => new Date(NOW) },
			menuKeyboard: () => new InlineKeyboard().text("Menu", "menu:home"),
			profileFlow: emptyProfileFlow(),
			targetFlow: emptyTargetFlow(),
			profileTypeLabel: String,
			topicLabel: String,
			upsertActorSnapshot: async () => {},
			occurredAt: () => new Date(NOW),
			getUpdateId: (ctx) => ctx.update.update_id,
		});
		const fake = telegramFake();
		const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
		bot.on("callback_query:data", async (ctx) => feature.handleOpaqueCallback(ctx, ctx.callbackQuery.data));
		await bot.init();
		await bot.handleUpdate(callback(1, "cb_stale", 700));
		expect(invokedActors).toEqual([{ kind: "telegram_user", telegramUserId: "700" }]);
		expect(fake.calls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
		expect(String(fake.lastMessage()?.text)).toContain("устарела");
	});

	it("binds an allowlisted admin before durable execution and routes an outsider exactly once", async () => {
		const unknown = vi.fn(async () => {});
		const moderation = {
			isAdminTelegramUserId: (userId: string) => userId === "900",
			lookup: vi.fn(async () => ({ ok: false as const, code: "not_found" as const })),
			hide: vi.fn(async () => ({ ok: false as const, code: "not_found" as const })),
		};
		const feature = createModerationTelegramFeature({ moderationService: moderation as never, replyUnknownCommand: unknown });
		const input = { kind: "message", text: "/admin https://t.me/collab_bot?start=c_token" } as CanonicalInput;
		expect(feature.resolveActor(input, "900")).toEqual({ kind: "admin", telegramUserId: "900" });
		expect(feature.resolveActor(input, "901")).toEqual({ kind: "telegram_user", telegramUserId: "901" });

		const ctx = { update: { update_id: 42 }, reply: async () => undefined } as unknown as Context;
		expect(await feature.routeCommand(ctx, "901", "/admin", "/admin anything")).toBe(true);
		expect(unknown).toHaveBeenCalledTimes(1);
		expect(moderation.lookup).not.toHaveBeenCalled();
		expect(await feature.routeCommand(ctx, "901", "/help", "/help")).toBe(false);
	});
});

function applicationsApi(overrides: Record<string, unknown> = {}): never {
	return {
		checkEligibility: async () => ({ ok: false, code: "target_unavailable" }),
		submit: async () => ({ ok: false, code: "target_unavailable" }),
		decide: async () => ({ ok: false, code: "target_unavailable" }),
		completeRecruitment: async () => ({ ok: false, code: "target_unavailable" }),
		getPairContact: async () => ({ ok: false, code: "unavailable" }),
		currentActionVersion: async () => undefined,
		listOwnApplications: async () => [],
		getAuthorManagement: async () => undefined,
		getAuthorManagementByPublicToken: async () => undefined,
		listAuthorManagement: async () => [],
		...overrides,
	} as never;
}

function emptyProfileFlow(): never {
	return {
		activeSessionKeyboard: async () => undefined,
		startApplicationMessage: async () => {},
		startQuickApplicationProfile: async () => {},
	} as never;
}

function emptyTargetFlow(): never {
	return {
		resolveApplicationTarget: async () => ({ kind: "handled" }),
		renderApplicationTarget: async () => {},
	} as never;
}

function telegramFake(): FakeTelegramApi {
	return new FakeTelegramApi({
		token: "fake-token",
		botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
	});
}

function callback(updateId: number, data: string, userId = 100): Update {
	return {
		update_id: updateId,
		callback_query: {
			id: `callback-${updateId}`,
			chat_instance: "chat-instance",
			from: { id: userId, is_bot: false, first_name: "Alice", username: "alice" },
			message: {
				message_id: updateId,
				date: Math.floor(NOW / 1_000),
				chat: { id: userId, type: "private", first_name: "Alice" },
				from: { id: userId, is_bot: false, first_name: "Alice", username: "alice" },
				text: "menu",
			},
			data,
		},
	};
}
