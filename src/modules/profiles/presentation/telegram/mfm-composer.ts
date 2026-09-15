import { replyWithProfilePhoto, type ProfilePhotoFallback } from "./profile-photo-reply.js";
import type { ProfilePhotoReader } from "../../application/ports/profile-photo-reader.js";
import { InlineKeyboard, type Context } from "grammy";
import type { OnboardingService, OnboardingView } from "../../application/onboarding-service.js";
import { decodeMfmCallback } from "./mfm-callback-codec.js";
import { contactRequestIds, renderOnboarding } from "./mfm-presentation.js";
import { COPY, NOTICES, tr } from "./mfm-copy.js";

export interface MfmTelegramOptions {
	readonly photoReader?: ProfilePhotoReader;
	readonly schedulePhotoLookup?: (ctx: Context, operation: () => Promise<void>) => void;
	readonly service: OnboardingService;
	readonly helpContact: string;
	readonly renderClassic: (ctx: Context, pendingStart?: string) => Promise<void>;
	readonly completed?: {
		show(ctx: Context, userId: string, prefix?: string): Promise<void>;
		showReady?(ctx: Context, userId: string): Promise<void>;
		routeStart(ctx: Context, userId: string, parameter: string): Promise<boolean>;
		routeText(ctx: Context, userId: string, text: string): Promise<void>;
		routeCallback(ctx: Context, userId: string, data: string): Promise<boolean>;
	};
}
export function createMfmTelegramFeature(options: MfmTelegramOptions) {
	const service = options.service;
	async function show(ctx: Context, view: OnboardingView, edit = false): Promise<void> {
		if (view.kind === "classic") { await options.renderClassic(ctx, view.pendingStart); return; }
		if (view.kind === "home" && options.completed !== undefined && ctx.from !== undefined) {
			if (view.notice === "saved" && options.completed.showReady !== undefined) { await options.completed.showReady(ctx, String(ctx.from.id)); return; }
			await options.completed.show(ctx, String(ctx.from.id), view.notice === undefined ? "" : `${tr(NOTICES[view.notice], view.language)}\n\n`); return;
		}
		const rendered = renderOnboarding(view);
		let fallback: ProfilePhotoFallback | undefined;
		if (view.kind === "step" && view.session.state.step === "photo" && view.session.state.photoCandidate !== undefined) {
			const state = { ...view.session.state }; delete state.photoCandidate;
			const recovery = renderOnboarding({ ...view, notice: "photo_preview_unavailable", session: { ...view.session, state } });
			fallback = { text: recovery.text, options: { reply_markup: recovery.keyboard } };
		}
		if (edit && ctx.callbackQuery?.message !== undefined && rendered.keyboard instanceof InlineKeyboard) await ctx.editMessageText(rendered.text, { reply_markup: rendered.keyboard });
		else await replyWithProfilePhoto(ctx, rendered.text, view.kind === "step" && view.session.state.step === "photo" ? view.session.state.photoCandidate ?? view.session.state.draft.photo : view.kind === "home" ? view.profile.photo : null, { reply_markup: rendered.keyboard }, fallback);
	}
	async function leaveContact(ctx: Context, view: OnboardingView, message: string): Promise<void> {
		await ctx.reply(message, { reply_markup: { remove_keyboard: true } });
		await show(ctx, view);
	}
	return {
		show,
		async start(ctx: Context, userId: string, pendingStart?: string): Promise<void> {
			const before = await service.view(userId);
			const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim();
			const view = await service.start(userId, name, pendingStart);
			if (view.kind === "home" && pendingStart !== undefined && options.completed !== undefined && await options.completed.routeStart(ctx, userId, pendingStart)) return;
			if (before.kind === "step" && view.kind === "step" && view.session.state.step !== "language") {
				await ctx.reply(tr(COPY.resumePrompt, view.language), { reply_markup: new InlineKeyboard().text(tr(COPY.resume, view.language), "mfm:resume") });
				return;
			}
			await show(ctx, view);
		},
		async routeText(ctx: Context, userId: string, text: string): Promise<boolean> {
			const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
			if (command === "/start") return false;
			const view = await service.view(userId);
			if (view.kind === "classic") return false;
			if (command === "/language") {
				const next = await service.language(userId);
				if (view.kind === "step" && view.session.state.step === "contact") await leaveContact(ctx, next, tr(COPY.contactClosed, view.language));
				else await show(ctx, next);
				return true;
			}
			if (command === "/help") { await ctx.reply(tr(COPY.help, view.language) + options.helpContact); return true; }
			if (view.kind === "home" && options.completed !== undefined) { await options.completed.routeText(ctx, userId, text); return true; }
			if (view.kind === "step" && view.session.state.step === "contact") {
				const value = text.trim();
				const proof = { generation: view.session.state.generation, revision: view.session.revision };
				if (value === tr(COPY.contactOther, view.language)) {
					await ctx.reply(tr(COPY.contactPublicLink, view.language), { reply_markup: { remove_keyboard: true } });
					return true;
				}
				let next: OnboardingView;
				let acknowledgement = tr(COPY.contactSelected, view.language);
				if (value === tr(COPY.contactTelegram, view.language)) next = await service.act(userId, { kind: "choice", value: "telegram_user" }, proof);
				else if (value === tr(COPY.skip, view.language)) { next = await service.act(userId, { kind: "next" }, proof); acknowledgement = tr(COPY.contactSkipped, view.language); }
				else if (value === tr(COPY.back, view.language)) { next = await service.act(userId, { kind: "back" }, proof); acknowledgement = tr(COPY.contactClosed, view.language); }
				else if (value === tr(view.session.state.editing ? COPY.cancel : COPY.later, view.language) || command === "/cancel") { next = await service.cancel(userId); acknowledgement = tr(COPY.contactClosed, view.language); }
				else next = await service.act(userId, { kind: "text", value }, proof);
				if (next.kind !== "step" || next.session.state.step !== "contact") await leaveContact(ctx, next, acknowledgement);
				else await show(ctx, next);
				return true;
			}
			if (command === "/cancel") { await show(ctx, await service.cancel(userId)); return true; }
			if (view.kind === "step" && !text.startsWith("/")) {
				await show(ctx, await service.act(userId, { kind: "text", value: text }, { generation: view.session.state.generation, revision: view.session.revision }));
			} else await show(ctx, view);
			return true;
		},
		async routeMessage(ctx: Context, userId: string): Promise<boolean> {
			const current = await service.view(userId);
			if (current.kind === "step" && current.session.state.step === "photo") {
				const sizes = ctx.message?.photo;
				if (sizes === undefined || sizes.length === 0 || ctx.message?.media_group_id !== undefined) {
					await show(ctx, { ...current, notice: "photo_invalid" }); return true;
				}
				const largest = sizes.reduce((best, size) => size.width * size.height > best.width * best.height ? size : best);
				await show(ctx, await service.selectPhoto(userId, { fileId: largest.file_id, botId: String(ctx.me.id) }, { generation: current.session.state.generation, revision: current.session.revision }));
				return true;
			}
			const shared = ctx.message?.chat_shared;
			if (shared === undefined) return false;
			const view = await service.view(userId);
			if (view.kind === "classic") return false;
			if (view.kind !== "step" || view.session.state.step !== "contact") { await show(ctx, view); return true; }
			const requestIds = contactRequestIds(view.session);
			const kind = shared.request_id === requestIds.channel ? "telegram_channel" : shared.request_id === requestIds.group ? "telegram_group" : undefined;
			if (kind === undefined) { await ctx.reply(tr(COPY.contactStale, view.language)); return true; }
			const username = shared.username?.trim().replace(/^@+/u, "");
			if (username === undefined || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(username)) {
				await ctx.reply(tr(COPY.contactPublicLink, view.language), { reply_markup: { remove_keyboard: true } });
				return true;
			}
			const rawTitle = shared.title?.trim();
			const title = rawTitle === undefined || rawTitle.length === 0 || rawTitle.length > 100 ? undefined : rawTitle;
			const next = await service.selectContact(userId, { kind, url: `https://t.me/${username}`, username, telegramChatId: String(shared.chat_id), ...(title === undefined ? {} : { title }) }, { generation: view.session.state.generation, revision: view.session.revision });
			const selected = title ?? `@${username}`;
			if (next.kind !== "step" || next.session.state.step !== "contact") await leaveContact(ctx, next, `${tr(COPY.contactSelected, view.language)}: ${selected}`);
			else await show(ctx, next);
			return true;
		},
		async routeCallback(ctx: Context, userId: string, data: string): Promise<boolean> {
			const view = await service.view(userId);
			if (view.kind === "classic" && !data.startsWith("m:") && !data.startsWith("mfm:")) return false;
			if (view.kind === "home" && options.completed !== undefined && await options.completed.routeCallback(ctx, userId, data)) return true;
			const parsed = decodeMfmCallback(data);
			if (parsed !== undefined) {
				const next = await service.act(userId, parsed.action, parsed.token);
				if (parsed.action.kind === "photo_telegram" && next.kind === "step" && next.session.state.step === "photo" && next.notice === undefined && next.session.revision !== parsed.token.revision) {
					const proof = { generation: next.session.state.generation, revision: next.session.revision };
					if (options.schedulePhotoLookup === undefined) { await show(ctx, { ...next, notice: "photo_unavailable" }); return true; }
					options.schedulePhotoLookup(ctx, async () => {
						const photo = await options.photoReader?.read(userId, String(ctx.me.id)) ?? null;
						await show(ctx, await service.selectPhoto(userId, photo, proof));
					});
					return true;
				}
				const edit = view.kind === "step" && next.kind === "step" && view.session.state.step === next.session.state.step && parsed.action.kind === "choice";
				await show(ctx, next, edit);
			} else if (data === "mfm:photo") await show(ctx, await service.edit(userId, true));
			else if (data === "mfm:edit") await show(ctx, await service.edit(userId));
			else await show(ctx, view);
			return true;
		},
	};
}
export type MfmTelegramFeature = ReturnType<typeof createMfmTelegramFeature>;
