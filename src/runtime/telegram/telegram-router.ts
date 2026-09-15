import { Bot, Composer, InlineKeyboard, type Context } from "grammy";
import type { Update } from "grammy/types";

import type { CanonicalInput } from "../../shared/application/commands/canonical-input.js";
import type { DurableCommandExecutor } from "../../shared/application/commands/command-executor.js";
import type { CallbackActionService } from "../../shared/application/commands/callback-action.js";
import type { Clock } from "../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../shared/application/ports/crypto.js";
import type { TelegramUserWriter } from "../../shared/application/ports/telegram-user-writer.js";
import {
	applicationStartCallback,
	createApplicationsTelegramFeature,
	type ApplicationsFeatureApi,
} from "../../modules/applications/index.js";
import {
	createCollaborationTelegramFeature,
	type CollaborationDraftService,
	type CollaborationPublicationService,
	type CollaborationTelegramFeature,
} from "../../modules/collaborations/index.js";
import { createMarketplaceTelegramFeature } from "../../modules/marketplace/index.js";
import type { CollaborationBrowseService } from "../../modules/marketplace/index.js";
import {
	createModerationTelegramFeature,
	type AdminModerationService,
	type ModerationTelegramFeature,
} from "../../modules/moderation/index.js";
import {
	applicationNavigationKeyboard,
	createProfileTelegramFeature,
	createMfmTelegramFeature,
	type MfmTelegramFeature,
	isCompleteProfile,
	profileTypeLabel,
	resumeKeyboard,
	topicLabel,
	type ProfileAudiencePlan,
	type ProfilePhotoReader,
	type ProfilePhotoFallback,
	PROFILE_PHOTO_REPLY,
	type ProfilePhotoReplyContext,
	type ProfileAudienceService,
	type ProfileDraft,
	type ProfileRecord,
	type OnboardingService,
	type ProfileService,
	type ProfileSessionRepository,
	type ProfileTelegramFeature,
} from "../../modules/profiles/index.js";
import { registerDurableTelegramIngress } from "./durable-telegram-ingress.js";
import { routeTelegramText } from "./telegram-routing.js";
import { webCryptoCapabilities } from "../../platform/crypto/capabilities.js";
import { createConnectionTelegramFeature, type ConnectionService, type IntroductionService } from "../../modules/connections/index.js";

const AUDIENCE_SNAPSHOT_UNAVAILABLE = "Аудиторию Telegram определить не удалось; профиль сохранён, число можно указать позже в «Мой профиль».";

export interface TelegramRouterOptions {
	readonly connectionService?: ConnectionService;
	readonly introductionService?: IntroductionService;
	readonly onboardingService?: OnboardingService;
	readonly profileService: ProfileService;
	readonly profilePhotoReader?: ProfilePhotoReader;
	readonly profileAudienceService?: ProfileAudienceService;
	readonly sessionRepository: ProfileSessionRepository;
	readonly telegramUserRepository: TelegramUserWriter & {
		findByTelegramUserId(telegramUserId: string): Promise<{ status: "active" | "blocked" } | undefined>;
	};
	readonly durableCommandExecutor: DurableCommandExecutor;
	readonly clock: Clock;
	readonly crypto?: CryptoCapabilities;
	readonly helpContact: string;
	readonly requestIdFactory?: () => number;
	readonly collaborationDraftService?: CollaborationDraftService;
	readonly collaborationPublicationService?: CollaborationPublicationService;
	readonly collaborationBrowseService?: CollaborationBrowseService;
	readonly applicationService?: ApplicationsFeatureApi;
	readonly callbackActionService?: CallbackActionService;
	readonly adminModerationService?: AdminModerationService;
}

export interface RegisteredTelegramRouter {
	readonly profileService: ProfileService;
}

export function registerTelegramRouter(bot: Bot, options: TelegramRouterOptions): RegisteredTelegramRouter {
	const crypto = options.crypto ?? webCryptoCapabilities;
	const marketplaceFeature = createMarketplaceTelegramFeature({
		...(options.collaborationBrowseService === undefined ? {} : { browseService: options.collaborationBrowseService }),
		applicationStartCallback,
		menuKeyboard: () => menuKeyboard(options),
	});
	const applicationsFeature = createApplicationsTelegramFeature({
		...(options.applicationService === undefined ? {} : { applicationsApi: options.applicationService }),
		...(options.callbackActionService === undefined ? {} : { callbackActionService: options.callbackActionService }),
		clock: options.clock,
		menuKeyboard: () => menuKeyboard(options),
		profileFlow: {
			activeSessionKeyboard: async (userId) => {
				const session = await profileFeature.findSession(userId);
				return session === undefined ? undefined : resumeKeyboard(session);
			},
			startApplicationMessage: (ctx, userId, continuation) => profileFeature.startApplicationMessage(ctx, userId, continuation),
			startQuickApplicationProfile: (ctx, userId, continuation) => profileFeature.startQuickApplicationProfile(ctx, userId, continuation),
		},
		targetFlow: {
			resolveApplicationTarget: (ctx, userId, publicToken) => marketplaceFeature.resolveApplicationTarget(ctx, userId, publicToken),
			renderApplicationTarget: (ctx, userId, publicToken) => marketplaceFeature.renderApplicationTarget(ctx, userId, publicToken),
		},
		profileTypeLabel,
		topicLabel,
		upsertActorSnapshot: (ctx) => upsertActorSnapshot(ctx, options),
		occurredAt: (ctx) => telegramOccurredAt(ctx.update),
		getUpdateId: (ctx) => getUpdateId(ctx.update),
	});
	const collaborationFeature = createCollaborationTelegramFeature({
		...(options.collaborationDraftService === undefined ? {} : { draftService: options.collaborationDraftService }),
		...(options.collaborationPublicationService === undefined ? {} : { publicationService: options.collaborationPublicationService }),
		menuKeyboard: () => menuKeyboard(options),
		profileFlow: {
			findSession: (userId) => profileFeature.findSession(userId),
			hasOwnProfile: async (userId) => isCompleteProfile(await options.profileService.getOwn(userId)),
			startForCollaboration: (ctx, userId) => profileFeature.startOrResume(ctx, userId, false, { kind: "create_collaboration" }),
			resumeKeyboard,
		},
		renderManagedCollaborations: (ctx, userId) => applicationsFeature.renderManagedCollaborations(ctx, userId),
	});
	const profileFeature = createProfileTelegramFeature({
		profileService: options.profileService,
		sessionRepository: options.sessionRepository,
		clock: options.clock,
		crypto,
		...(options.requestIdFactory === undefined ? {} : { requestIdFactory: options.requestIdFactory }),
		...(options.applicationService === undefined ? {} : { applicationService: options.applicationService }),
		menuKeyboard: () => menuKeyboard(options),
		isCollaborationActive: (userId) => collaborationFeature.isActive(userId),
		continueCreateCollaboration: (ctx, userId) => collaborationFeature.continueAfterProfile(ctx, userId),
		scheduleProfileAudience: (ctx, profile, draft) => scheduleProfileAudience(ctx, options, profile, draft),
		reopenApplicationCard: (ctx, userId, collaborationId) => applicationsFeature.reopenApplicationCard(ctx, userId, collaborationId),
		replyApplicationFailure: (ctx, code, session, profileWasSaved) => applicationsFeature.replyApplicationFailure(ctx, code, session === undefined ? undefined : applicationNavigationKeyboard(session), profileWasSaved),
		occurredAt: (ctx) => telegramOccurredAt(ctx.update).getTime(),
	});
	const moderationFeature = createModerationTelegramFeature({
		...(options.adminModerationService === undefined ? {} : { moderationService: options.adminModerationService }),
		replyUnknownCommand: (ctx) => replyUnknownCommand(ctx, options),
	});

	const mfmFeature = options.onboardingService === undefined ? undefined : createMfmTelegramFeature({
		...(options.connectionService === undefined ? {} : { completed: createConnectionTelegramFeature(options.connectionService, options.introductionService) }),
		service: options.onboardingService,
		...(options.profilePhotoReader === undefined ? {} : { photoReader: options.profilePhotoReader }),
		schedulePhotoLookup: (ctx, operation) => {
			const collector = (ctx as CollectedContext)[REPLY_COLLECTOR];
			if (collector === undefined) throw new Error("photo lookup requires a durable collector");
			collector.afterCommit = operation;
		},
		helpContact: options.helpContact,
		renderClassic: async (ctx, pendingStart) => {
			const userId = String(ctx.from!.id);
			if (pendingStart !== undefined && await applicationsFeature.routeStart(ctx, userId, pendingStart)) return;
			if (pendingStart !== undefined && await marketplaceFeature.routeStart(ctx, userId, pendingStart)) return;
			await renderMenu(ctx, options, profileFeature, collaborationFeature, userId);
		},
	});

	const messageRoute = new Composer<Context>();
	messageRoute.on("message", async (workCtx, next) => {
		if (workCtx.chat?.type !== "private" || workCtx.from === undefined) return;
		if (!(await ensureActor(workCtx, options))) return;
		if (workCtx.message.text === undefined && options.onboardingService !== undefined && mfmFeature !== undefined) {
			if (await mfmFeature.routeMessage(workCtx, String(workCtx.from.id))) return;
			const view = await options.onboardingService.view(String(workCtx.from.id));
			if (view.kind !== "classic") { await mfmFeature.show(workCtx, view); return; }
		}
		await next();
	});
	messageRoute.on("message:text", async (workCtx, next) => {
		const userId = String(workCtx.from.id);
		const text = workCtx.message.text;
		const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
		if (await moderationFeature.routeCommand(workCtx, userId, command, text)) return;
		if (mfmFeature !== undefined && await mfmFeature.routeText(workCtx, userId, text)) return;
		const handled = await routeTelegramText(workCtx, userId, text, {
			routeModeration: async () => false,
			routeStart: async (ctx, actorId, startParameter) => {
				if (mfmFeature !== undefined) { await mfmFeature.start(ctx, actorId, startParameter); return true; }
				if (ctx.from !== undefined) {
					await options.profileService.ensureFromTelegram(actorId, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim());
				}
				if (await applicationsFeature.routeStart(ctx, actorId, startParameter)) return true;
				return marketplaceFeature.routeStart(ctx, actorId, startParameter);
			},
			renderMenu: (ctx, actorId) => renderMenu(ctx, options, profileFeature, collaborationFeature, actorId),
			renderHelp: (ctx) => ctx.reply(`«Давай вместе» помогает блогерам, Telegram-каналам, заведениям и брендам находить партнёров для совместных проектов.\n\nСейчас сервис работает в Екатеринбурге. Вы можете создать и отредактировать свой профиль. По вопросам работы бота: ${options.helpContact}`),
			routeCollaboration: (ctx, actorId, command) => collaborationFeature.routeCommand(ctx, actorId, command),
			routeMarketplace: async (ctx, actorId, command) => {
				if (await applicationsFeature.routeCommand(ctx, actorId, command)) return true;
				return marketplaceFeature.routeCommand(ctx, actorId, command);
			},
		});
		if (handled) return;
		await next();
	});
	messageRoute.use(profileFeature.composer);
	messageRoute.use(collaborationFeature.composer);
	messageRoute.on("message:text", async (workCtx) => {
		await replyUnknownCommand(workCtx, options);
	});

	const callbackRoute = new Composer<Context>();
	callbackRoute.on("callback_query:data", async (workCtx, next) => {
		const callbackQuery = workCtx.callbackQuery;
		if (callbackQuery.message?.chat.type !== "private" || workCtx.from === undefined) {
			await workCtx.answerCallbackQuery();
			return;
		}
		if (!(await ensureActor(workCtx, options))) {
			await workCtx.answerCallbackQuery();
			return;
		}
		await workCtx.answerCallbackQuery();
		if (mfmFeature !== undefined && await mfmFeature.routeCallback(workCtx, String(workCtx.from.id), callbackQuery.data)) return;
		await next();
	});
	callbackRoute.use(profileFeature.composer);
	callbackRoute.use(collaborationFeature.composer);
	callbackRoute.use(marketplaceFeature.composer);
	callbackRoute.use(applicationsFeature.composer);
	callbackRoute.on("callback_query:data", async (workCtx) => {
		const userId = String(workCtx.from.id);
		switch (workCtx.callbackQuery.data) {
			case "menu:home":
				await renderMenu(workCtx, options, profileFeature, collaborationFeature, userId);
				return;
			case "profile:unavailable":
				await workCtx.reply("Этот раздел пока готовится. Сейчас вы можете создать и отредактировать профиль.", { reply_markup: menuKeyboard(options) });
				return;
		}
	});

	registerDurableTelegramIngress(bot, {
		executeDurably: (ctx, input, route) => runDurable(ctx, options, profileFeature, moderationFeature, input, route, mfmFeature),
		messageRoute: messageRoute.middleware(),
		callbackRoute: callbackRoute.middleware(),
		opaqueCallbackRoute: async (ctx) => {
			const data = ctx.callbackQuery?.data;
			if (options.onboardingService !== undefined && mfmFeature !== undefined && ctx.from !== undefined) {
				if (ctx.callbackQuery?.message?.chat.type !== "private") { await ctx.answerCallbackQuery(); return; }
				const view = await options.onboardingService.view(String(ctx.from.id));
				if (view.kind !== "classic") { await ctx.answerCallbackQuery(); const replay = new ReplyCollector(); await mfmFeature.show(replay.context(ctx), view); await replay.dispatchReplies(ctx, false); return; }
			}
			if (data !== undefined) await applicationsFeature.handleOpaqueCallback(ctx, data);
		},
	});
	return { profileService: options.profileService };
}

function replyUnknownCommand(ctx: Context, options: TelegramRouterOptions): Promise<unknown> {
	return ctx.reply("Не удалось распознать команду. Откройте главное меню командой /start или воспользуйтесь /help.", { reply_markup: menuKeyboard(options) });
}

type ReplyOptions = Parameters<Context["reply"]>[1];
type EditOptions = Parameters<Context["editMessageText"]>[1];
type AnswerOptions = Parameters<Context["answerCallbackQuery"]>[0];
interface ReplyAction { readonly text: string; readonly options?: ReplyOptions; }
interface ProfileAudienceAction { readonly plan: ProfileAudiencePlan; readonly replyIndex: number; }

const REPLY_COLLECTOR = Symbol("reply-collector");
type CollectedContext = Context & { readonly [REPLY_COLLECTOR]?: ReplyCollector };

export class ReplyCollector {
	afterCommit: (() => Promise<void>) | undefined;
	private readonly orderedReplies: ({ kind: "text"; index: number } | { kind: "photo"; fileId: string; options?: Parameters<Context["replyWithPhoto"]>[1]; fallback?: ProfilePhotoFallback })[] = [];
	readonly replies: ReplyAction[] = [];
	readonly edits: { readonly text: string; readonly options?: EditOptions }[] = [];
	readonly answers: AnswerOptions[] = [];
	private audienceAction: ProfileAudienceAction | undefined;

	context(ctx: Context): Context {
		const proxy = Object.create(ctx) as Context & { [PROFILE_PHOTO_REPLY]: NonNullable<ProfilePhotoReplyContext[typeof PROFILE_PHOTO_REPLY]> };
		Object.defineProperty(proxy, REPLY_COLLECTOR, { value: this });
		proxy.reply = async (text: string, options?: ReplyOptions) => {
			this.orderedReplies.push({ kind: "text", index: this.replies.length });
			if (options === undefined) this.replies.push({ text });
			else this.replies.push({ text, options });
			return undefined as never;
		};
		proxy[PROFILE_PHOTO_REPLY] = async (fileId, options, fallback) => {
			if (!/^[A-Za-z0-9_-]{1,1024}$/.test(fileId)) throw new Error("buffered photos require a file reference");
			this.orderedReplies.push({ kind: "photo", fileId, ...(options === undefined ? {} : { options }), ...(fallback === undefined ? {} : { fallback }) });
		};
		proxy.replyWithPhoto = async (photo, options) => {
			if (typeof photo !== "string") throw new Error("buffered photos require a file reference");
			await proxy[PROFILE_PHOTO_REPLY](photo, options);
			return undefined as never;
		};
		proxy.editMessageText = async (text: string, options?: EditOptions) => {
			this.edits.push({ text, ...(options === undefined ? {} : { options }) });
			return undefined as never;
		};
		proxy.answerCallbackQuery = async (options?: AnswerOptions) => {
			if (options !== undefined) this.answers.push(options);
			else this.answers.push(undefined as never);
			return true;
		};
		return proxy;
	}

	get hasReplies(): boolean { return this.orderedReplies.length > 0; }
	async dispatchReplies(ctx: Context, includePhotos = true): Promise<void> {
		for (const action of this.orderedReplies) {
			if (action.kind === "text") {
				const reply = this.replies[action.index]!;
				if (reply.options === undefined) await ctx.reply(reply.text);
				else await ctx.reply(reply.text, reply.options);
			} else {
				if (includePhotos) {
					try { await ctx.replyWithPhoto(action.fileId, action.options); continue; }
					catch { /* Never retry ambiguous media; keep the text/recovery controls usable. */ }
				}
				if (action.fallback !== undefined) await ctx.reply(action.fallback.text, action.fallback.options);
				else if (action.options?.caption) await ctx.reply(action.options.caption, action.options.reply_markup === undefined ? undefined : { reply_markup: action.options.reply_markup });
			}
		}
	}

	scheduleAudience(plan: ProfileAudiencePlan): void {
		if (this.audienceAction !== undefined) throw new Error("only one profile audience action may be scheduled per update");
		const replyIndex = this.replies.length - 1;
		if (replyIndex < 0) throw new Error("profile audience action requires a saved-profile reply");
		this.audienceAction = { plan, replyIndex };
	}

	takeAudienceAction(): ProfileAudienceAction | undefined { return this.audienceAction; }
	appendToReply(replyIndex: number, line: string): void {
		const reply = this.replies[replyIndex];
		if (reply === undefined) throw new Error("profile audience reply target is missing");
		this.replies[replyIndex] = { ...reply, text: `${reply.text}\n\n${line}` };
	}
}

function scheduleProfileAudience(ctx: Context, options: TelegramRouterOptions, profile: ProfileRecord, draft: ProfileDraft): void {
	const plan = options.profileAudienceService?.plan(profile, draft.audienceAutofill ?? "allow");
	if (plan === undefined) return;
	const collector = (ctx as CollectedContext)[REPLY_COLLECTOR];
	if (collector === undefined) throw new Error("profile audience action must use a durable reply collector");
	collector.scheduleAudience(plan);
}

async function runDurable(
	ctx: Context,
	options: TelegramRouterOptions,
	profileFeature: ProfileTelegramFeature,
	moderationFeature: ModerationTelegramFeature,
	input: CanonicalInput,
	effect: (workContext: Context) => Promise<void>,
	mfmFeature?: MfmTelegramFeature,
): Promise<void> {
	const updateId = getUpdateId(ctx.update);
	const from = ctx.from;
	if (updateId === undefined || from === undefined) return;
	const collector = new ReplyCollector();
	const workContext = collector.context(ctx);
	const telegramUserId = String(from.id);
	await options.durableCommandExecutor.execute({
		context: {
			commandId: `telegram:update:${updateId}`,
			telegramUpdateId: updateId,
			actor: moderationFeature.resolveActor(input, telegramUserId),
			occurredAt: telegramOccurredAt(ctx.update),
		},
		input,
		effect: async () => {
			await effect(workContext);
			return { version: 1, outcome: "completed", messageKey: "command_completed" };
		},
	});
	const inputRecord = input !== null && typeof input === "object" && !Array.isArray(input) ? input as { readonly kind?: unknown } : undefined;
	if (!collector.hasReplies && collector.afterCommit === undefined && collector.answers.length === 0 && collector.edits.length === 0 && inputRecord?.kind === "callback_query") {
		await ctx.answerCallbackQuery();
		if (ctx.chat?.type !== "private") return;
		if (options.onboardingService !== undefined && mfmFeature !== undefined) {
			const view = await options.onboardingService.view(telegramUserId);
			if (view.kind !== "classic") { const replay = new ReplyCollector(); await mfmFeature.show(replay.context(ctx), view); await replay.dispatchReplies(ctx, false); return; }
		}
		const session = await profileFeature.findSession(telegramUserId);
		if (session !== undefined) await ctx.reply("Запрос уже обработан. Текущий шаг сохранён.", { reply_markup: resumeKeyboard(session) });
		else if (await options.profileService.getOwn(telegramUserId) !== undefined) await ctx.reply("Запрос уже обработан. Профиль уже сохранён.", { reply_markup: menuKeyboard(options) });
		else await ctx.reply("Запрос уже обработан.", { reply_markup: menuKeyboard(options) });
		return;
	}
	for (const answer of collector.answers) {
		if (answer === undefined) await ctx.answerCallbackQuery();
		else await ctx.answerCallbackQuery(answer);
	}
	for (const edit of collector.edits) {
		try { await ctx.editMessageText(edit.text, edit.options); }
		catch (error) {
			if (error instanceof Error && /message is not modified/i.test(error.message)) continue;
			await ctx.reply(edit.text, edit.options?.reply_markup === undefined ? undefined : { reply_markup: edit.options.reply_markup });
		}
	}
	let postCommitError: unknown;
	const audienceAction = collector.takeAudienceAction();
	if (audienceAction !== undefined && options.profileAudienceService !== undefined) {
		try {
			const outcome = await options.profileAudienceService.execute(audienceAction.plan);
			collector.appendToReply(audienceAction.replyIndex, outcome.kind === "applied"
				? `Аудитория Telegram: ${outcome.audienceSize} — снимок на момент сохранения.`
				: AUDIENCE_SNAPSHOT_UNAVAILABLE);
		} catch (error) {
			collector.appendToReply(audienceAction.replyIndex, AUDIENCE_SNAPSHOT_UNAVAILABLE);
			postCommitError = error;
		}
	}
	if (collector.afterCommit !== undefined) await collector.afterCommit();
	await collector.dispatchReplies(ctx);
	if (postCommitError !== undefined) throw postCommitError;
}

async function renderMenu(
	ctx: Context,
	options: TelegramRouterOptions,
	profileFeature: ProfileTelegramFeature,
	collaborationFeature: CollaborationTelegramFeature,
	userId: string,
): Promise<void> {
	const session = await profileFeature.findSession(userId);
	const keyboard = menuKeyboard(options);
	if (session !== undefined) keyboard.row().text("▶️ Продолжить профиль", "profile:resume");
	if (await collaborationFeature.isActive(userId)) keyboard.row().text("▶️ Продолжить коллаборацию", "collaboration:resume");
	await ctx.reply("Добро пожаловать в «Давай вместе» — сервис для поиска партнёров и совместных проектов.\n\nСейчас мы начинаем с Екатеринбурга. Выберите, что хотите сделать:", { reply_markup: keyboard });
}

async function ensureActor(ctx: Context, options: TelegramRouterOptions): Promise<boolean> {
	if (ctx.from === undefined) return false;
	const id = String(ctx.from.id);
	await upsertActorSnapshot(ctx, options);
	const record = await options.telegramUserRepository.findByTelegramUserId(id);
	return record?.status === "active";
}

async function upsertActorSnapshot(ctx: Context, options: TelegramRouterOptions): Promise<void> {
	if (ctx.from === undefined) return;
	const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim() || "Telegram user";
	await options.telegramUserRepository.upsert({
		telegramUserId: String(ctx.from.id),
		...(ctx.from.username === undefined ? {} : { username: ctx.from.username }),
		displayName,
		updatedAt: options.clock.now().getTime(),
	});
}

function getUpdateId(update: Update): number | undefined {
	return Number.isSafeInteger(update.update_id) && update.update_id >= 0 ? update.update_id : undefined;
}

function telegramOccurredAt(update: Update): Date {
	const candidate = "message" in update && update.message !== undefined
		? update.message.date
		: "callback_query" in update && update.callback_query?.message !== undefined
			? update.callback_query.message.date
			: undefined;
	if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= Math.floor(Number.MAX_SAFE_INTEGER / 1000)) {
		return new Date(candidate * 1000);
	}
	return new Date(update.update_id);
}

function menuKeyboard(options?: TelegramRouterOptions): InlineKeyboard {
	const collaborationAction = options?.collaborationDraftService === undefined ? "profile:unavailable" : "collaboration:start";
	const browseAction = options?.collaborationBrowseService === undefined ? "profile:unavailable" : "browse:start";
	return new InlineKeyboard()
		.text("➕ Создать коллаборацию", collaborationAction).row()
		.text("🔎 Найти коллаборацию", browseAction).row()
		.text("📋 Мои коллаборации", options?.collaborationPublicationService === undefined ? "profile:unavailable" : "collaboration:own").row()
		.text("💬 Мои отклики", options?.applicationService === undefined ? "profile:unavailable" : "application:own").row()
		.text("👤 Мой профиль", "profile:view");
}
