import type { Context } from "grammy";
import type { ConnectionService, ConnectionView, IntroductionService, IntroductionView } from "../../application/index.js";
import { decodeConnectionCallback } from "./connection-callback-codec.js";
import { renderConnection } from "./connection-presentation.js";
import { renderIntroduction } from "./introduction-presentation.js";
import { decodeIntroductionCallback } from "./introduction-callback-codec.js";

export function createConnectionTelegramFeature(service: ConnectionService, introductions?: IntroductionService) {
	async function show(ctx: Context, view: ConnectionView, prefix = ""): Promise<void> {
		const rendered = renderConnection(view, introductions !== undefined);
		await ctx.reply(prefix + rendered.text, { reply_markup: rendered.keyboard });
	}
	async function showIntroduction(ctx: Context, userId: string, view: IntroductionView, prefix = ""): Promise<void> {
		if (view.kind === "none" && view.notice === undefined) { await show(ctx, await service.view(userId), prefix); return; }
		const rendered = renderIntroduction(view);
		await ctx.reply(prefix + rendered.text, { reply_markup: rendered.keyboard });
	}
	async function current(ctx: Context, userId: string, prefix = "", fallback?: ConnectionView): Promise<void> {
		if (introductions !== undefined) {
			const view = await introductions.view(userId);
			if (view.kind !== "none" || view.notice !== undefined) { await showIntroduction(ctx, userId, view, prefix); return; }
		}
		await show(ctx, fallback ?? await service.view(userId), prefix);
	}
	return {
		show: current,
		async routeStart(ctx: Context, userId: string, parameter: string): Promise<boolean> {
			if (introductions === undefined || !parameter.startsWith("n_")) return false;
			await showIntroduction(ctx, userId, await introductions.openRequest(userId, parameter.slice(2))); return true;
		},
		async routeText(ctx: Context, userId: string, text: string) {
			const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
			if (introductions !== undefined) {
				const view = await introductions.view(userId);
				if (view.kind !== "unavailable" && view.session.state.introduction !== undefined) {
					const proof = { generation: view.session.state.generation, revision: view.session.revision };
					const next = command === "/cancel" ? await introductions.act(userId, { kind: "cancel" }, proof) : view.kind === "compose" && !text.startsWith("/") ? await introductions.act(userId, { kind: "message", value: text }, proof) : view;
					await showIntroduction(ctx, userId, next); return;
				}
			}
			await show(ctx, command === "/profile" ? await service.open(userId, "profile") : command === "/cancel" ? await service.open(userId, "home") : await service.view(userId));
		},
		async routeCallback(ctx: Context, userId: string, data: string): Promise<boolean> {
			if (data.startsWith("i:") && introductions !== undefined) {
				const parsed = decodeIntroductionCallback(data);
				await showIntroduction(ctx, userId, parsed === undefined ? await introductions.view(userId) : await introductions.act(userId, parsed.action, parsed.proof)); return true;
			}
			if (!data.startsWith("n:")) return false;
			const parsed = decodeConnectionCallback(data);
			await current(ctx, userId, "", parsed === undefined ? await service.view(userId) : await service.act(userId, parsed.action, parsed.proof));
			return true;
		},
	};
}
