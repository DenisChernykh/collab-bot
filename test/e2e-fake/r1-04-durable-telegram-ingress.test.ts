import { Bot, Composer, type Context } from "grammy";
import type { UserFromGetMe, Update } from "grammy/types";
import { describe, expect, it } from "vitest";

import type { CanonicalInput } from "../../src/shared/application/commands/canonical-input.js";
import {
	registerDurableTelegramIngress,
	type ExecuteDurableTelegramRoute,
} from "../../src/presentation/telegram/durable-telegram-ingress.js";
import { FakeTelegramApi } from "../support/fake-telegram-api.js";

const DURABLE_PROXY = Symbol("durable-proxy");
type MarkedContext = Context & { readonly [DURABLE_PROXY]?: true };
type ReplyOptions = Parameters<Context["reply"]>[1];
type AnswerOptions = Parameters<Context["answerCallbackQuery"]>[0];

describe("R1-04 durable Telegram ingress", () => {
	it("routes generic updates once through a durable proxy and keeps opaque callbacks outside the envelope", async () => {
		const fake = new FakeTelegramApi({
			token: "fake-token",
			botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
		});
		const events: string[] = [];
		const fetchWithEvents: typeof fetch = async (input, init) => {
			const method = String(input).split("/").at(-1) ?? "unknown";
			if (method !== "getMe") events.push(`api:${method}`);
			return fake.fetch(input, init);
		};
		const bot = new Bot("fake-token", { client: { fetch: fetchWithEvents } });
		const routeCalls = { message: 0, callback: 0, opaque: 0 };
		const messageRoute = new Composer<Context>();
		messageRoute.on("message", async (ctx, next) => {
			routeCalls.message += 1;
			events.push((ctx as MarkedContext)[DURABLE_PROXY] === true ? "route:message:proxy" : "route:message:source");
			await ctx.reply("durable message reply");
			await next();
			events.push("route:message:terminal-return");
		});
		const callbackRoute = new Composer<Context>();
		callbackRoute.on("callback_query:data", async (ctx, next) => {
			routeCalls.callback += 1;
			events.push((ctx as MarkedContext)[DURABLE_PROXY] === true ? "route:callback:proxy" : "route:callback:source");
			await ctx.answerCallbackQuery();
			await next();
			events.push("route:callback:terminal-return");
		});
		const completedUpdates = new Set<number>();
		const durableInputs: CanonicalInput[] = [];
		const executeDurably: ExecuteDurableTelegramRoute = async (sourceContext, input, route) => {
			durableInputs.push(input);
			const updateId = sourceContext.update.update_id;
			const kind = (input as { readonly kind: string }).kind;
			if (completedUpdates.has(updateId)) {
				events.push(`durable:${kind}:replay`);
				return;
			}
			const pendingDelivery: (() => Promise<unknown>)[] = [];
			const proxy = Object.create(sourceContext) as Context;
			Object.defineProperty(proxy, DURABLE_PROXY, { value: true });
			proxy.reply = async (text, options?: ReplyOptions) => {
				pendingDelivery.push(async () => options === undefined
					? sourceContext.reply(text)
					: sourceContext.reply(text, options));
				return undefined as never;
			};
			proxy.answerCallbackQuery = async (options?: AnswerOptions) => {
				pendingDelivery.push(async () => options === undefined
					? sourceContext.answerCallbackQuery()
					: sourceContext.answerCallbackQuery(options));
				return true;
			};
			events.push(`durable:${kind}:begin`);
			await route(proxy);
			events.push(`durable:${kind}:commit`);
			completedUpdates.add(updateId);
			for (const deliver of pendingDelivery) await deliver();
		};

		registerDurableTelegramIngress(bot, {
			executeDurably,
			messageRoute: messageRoute.middleware(),
			callbackRoute: callbackRoute.middleware(),
			opaqueCallbackRoute: async (ctx) => {
				routeCalls.opaque += 1;
				events.push("route:opaque:source");
				await ctx.answerCallbackQuery();
			},
		});
		await bot.init();
		events.length = 0;

		const messageUpdate = message(1, "hello");
		await bot.handleUpdate(messageUpdate);
		await bot.handleUpdate(messageUpdate);
		await bot.handleUpdate(callback(2, "profile:view"));
		const durableCallsBeforeOpaque = durableInputs.length;
		await bot.handleUpdate(callback(3, "cb_opaque-token"));

		expect(routeCalls).toEqual({ message: 1, callback: 1, opaque: 1 });
		expect(durableInputs).toEqual([
			{ kind: "message", text: "hello", hasChatShared: false },
			{ kind: "message", text: "hello", hasChatShared: false },
			{ kind: "callback_query", data: "profile:view" },
		]);
		expect(durableInputs).toHaveLength(durableCallsBeforeOpaque);
		expect(events).toEqual([
			"durable:message:begin",
			"route:message:proxy",
			"route:message:terminal-return",
			"durable:message:commit",
			"api:sendMessage",
			"durable:message:replay",
			"durable:callback_query:begin",
			"route:callback:proxy",
			"route:callback:terminal-return",
			"durable:callback_query:commit",
			"api:answerCallbackQuery",
			"route:opaque:source",
			"api:answerCallbackQuery",
		]);
	});
});

function message(updateId: number, text: string): Update {
	return {
		update_id: updateId,
		message: {
			message_id: updateId,
			date: 1_700_000_000,
			chat: { id: 100, type: "private", first_name: "Alice" },
			from: { id: 100, is_bot: false, first_name: "Alice" },
			text,
		},
	};
}

function callback(updateId: number, data: string): Update {
	return {
		update_id: updateId,
		callback_query: {
			id: `callback-${updateId}`,
			chat_instance: "chat-instance",
			from: { id: 100, is_bot: false, first_name: "Alice" },
			message: message(updateId, "menu").message!,
			data,
		},
	};
}
