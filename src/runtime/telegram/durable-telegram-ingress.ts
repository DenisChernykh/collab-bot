import { Composer, type Context, type MiddlewareFn } from "grammy";

import type { CanonicalInput } from "../../shared/application/commands/canonical-input.js";

export type ExecuteDurableTelegramRoute = (
	sourceContext: Context,
	input: CanonicalInput,
	route: (durableContext: Context) => Promise<void>,
) => Promise<void>;

export interface DurableTelegramIngressOptions {
	readonly executeDurably: ExecuteDurableTelegramRoute;
	readonly messageRoute: MiddlewareFn<Context>;
	readonly callbackRoute: MiddlewareFn<Context>;
	readonly opaqueCallbackRoute: MiddlewareFn<Context>;
}

type TelegramIngressRoute = "message" | "callback" | "opaque_callback";

export function registerDurableTelegramIngress(
	target: Composer<Context>,
	options: DurableTelegramIngressOptions,
): void {
	const ingress = new Composer<Context>();
	ingress.route<TelegramIngressHandlers>(classifyTelegramIngress, {
		message: async (ctx) => {
			const message = ctx.message;
			if (message === undefined) return;
			await options.executeDurably(
				ctx,
				{ kind: "message", text: message.text ?? "", hasChatShared: message.chat_shared !== undefined },
				(durableContext) => runTerminal(options.messageRoute, durableContext),
			);
		},
		callback: async (ctx) => {
			const data = ctx.callbackQuery?.data;
			if (data === undefined) return;
			await options.executeDurably(
				ctx,
				{ kind: "callback_query", data },
				(durableContext) => runTerminal(options.callbackRoute, durableContext),
			);
		},
		opaque_callback: options.opaqueCallbackRoute,
	});
	target.use(ingress);
}

type TelegramIngressHandlers = Record<TelegramIngressRoute, MiddlewareFn<Context>>;

function classifyTelegramIngress(ctx: Context): TelegramIngressRoute | undefined {
	const callbackData = ctx.callbackQuery?.data;
	if (callbackData !== undefined) return callbackData.startsWith("cb_") ? "opaque_callback" : "callback";
	return ctx.message === undefined ? undefined : "message";
}

async function runTerminal(route: MiddlewareFn<Context>, durableContext: Context): Promise<void> {
	await route(durableContext, async () => {});
}
