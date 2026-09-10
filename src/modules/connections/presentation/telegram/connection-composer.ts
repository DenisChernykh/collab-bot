import type { Context } from "grammy";
import type { ConnectionService, ConnectionView } from "../../application/index.js";
import { decodeConnectionCallback } from "./connection-callback-codec.js";
import { renderConnection } from "./connection-presentation.js";

export function createConnectionTelegramFeature(service: ConnectionService) {
	async function show(ctx: Context, view: ConnectionView, prefix = ""): Promise<void> {
		const rendered = renderConnection(view);
		await ctx.reply(prefix + rendered.text, { reply_markup: rendered.keyboard });
	}
	return {
		async show(ctx: Context, userId: string, prefix = "") { await show(ctx, await service.view(userId), prefix); },
		async routeText(ctx: Context, userId: string, text: string) {
			const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
			await show(ctx, command === "/profile" ? await service.open(userId, "profile") : command === "/cancel" ? await service.open(userId, "home") : await service.view(userId));
		},
		async routeCallback(ctx: Context, userId: string, data: string): Promise<boolean> {
			if (!data.startsWith("n:")) return false;
			const parsed = decodeConnectionCallback(data);
			await show(ctx, parsed === undefined ? await service.view(userId) : await service.act(userId, parsed.action, parsed.proof));
			return true;
		},
	};
}
