import { InlineKeyboard, type Context } from "grammy";
import type { OnboardingService, OnboardingView } from "../../application/onboarding-service.js";
import { decodeMfmCallback } from "./mfm-callback-codec.js";
import { renderOnboarding } from "./mfm-presentation.js";
import { COPY, tr } from "./mfm-copy.js";

export interface MfmTelegramOptions {
	readonly service: OnboardingService;
	readonly helpContact: string;
	readonly renderClassic: (ctx: Context, pendingStart?: string) => Promise<void>;
}
export function createMfmTelegramFeature(options: MfmTelegramOptions) {
	const service = options.service;
	async function show(ctx: Context, view: OnboardingView, edit = false): Promise<void> {
		if (view.kind === "classic") { await options.renderClassic(ctx, view.pendingStart); return; }
		const rendered = renderOnboarding(view);
		if (edit && ctx.callbackQuery?.message !== undefined) await ctx.editMessageText(rendered.text, { reply_markup: rendered.keyboard });
		else await ctx.reply(rendered.text, { reply_markup: rendered.keyboard });
	}
	return {
		show,
		async start(ctx: Context, userId: string, pendingStart?: string): Promise<void> {
			const before = await service.view(userId);
			const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim();
			const view = await service.start(userId, name, pendingStart);
			if (before.kind === "step" && view.kind === "step" && view.session.state.step !== "language") {
				await ctx.reply(tr(COPY.resumePrompt, view.language), { reply_markup: new InlineKeyboard().text(tr(COPY.resume, view.language), "mfm:resume") });
				return;
			}
			await show(ctx, view);
		},
		async routeText(ctx: Context, userId: string, text: string): Promise<boolean> {
			const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
			if (command === "/start") return false;
			if (command === "/language") { await show(ctx, await service.language(userId)); return true; }
			const view = await service.view(userId);
			if (view.kind === "classic") return false;
			if (command === "/help") { await ctx.reply(tr(COPY.help, view.language) + options.helpContact); return true; }
			if (command === "/cancel") { await show(ctx, await service.cancel(userId)); return true; }
			if (view.kind === "step" && !text.startsWith("/")) {
				await show(ctx, await service.act(userId, { kind: "text", value: text }, { generation: view.session.state.generation, revision: view.session.revision }));
			} else await show(ctx, view);
			return true;
		},
		async routeCallback(ctx: Context, userId: string, data: string): Promise<boolean> {
			const view = await service.view(userId);
			if (view.kind === "classic" && !data.startsWith("m:") && !data.startsWith("mfm:")) return false;
			const parsed = decodeMfmCallback(data);
			if (parsed !== undefined) {
				const next = await service.act(userId, parsed.action, parsed.token);
				const edit = view.kind === "step" && next.kind === "step" && view.session.state.step === next.session.state.step && (parsed.action.kind === "choice" || parsed.action.kind === "page");
				await show(ctx, next, edit);
			} else if (data === "mfm:edit") await show(ctx, await service.edit(userId));
			else await show(ctx, view);
			return true;
		},
	};
}
export type MfmTelegramFeature = ReturnType<typeof createMfmTelegramFeature>;
