import { randomBytes, randomInt } from "node:crypto";

import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { Update } from "grammy/types";

import type { Clock } from "../application/ports/clock.js";
import type { CanonicalInput } from "../application/commands/canonical-input.js";
import type { DurableCommandExecutor } from "../application/commands/command-executor.js";
import type { CallbackActionService } from "../application/commands/callback-action.js";
import type { SafeResult } from "../application/commands/safe-result.js";
import type {
	ProfileSessionRepository,
	ProfileSessionRecord,
	ProfileSessionState,
	ProfileDraft,
} from "../application/ports/profile-session-repository.js";
import { PROFILE_SESSION_TTL_MS, PROFILE_SESSION_VERSION } from "../application/ports/profile-session-repository.js";
import type { TelegramUserWriter } from "../application/ports/telegram-user-writer.js";
import { ProfileService } from "../application/profiles/profile-service.js";
import {
	CollaborationDraftService,
	CollaborationDraftStaleError,
	CollaborationProfileRequiredError,
	CollaborationWizardConflictError,
	type CollaborationDraftStartResult,
} from "../application/collaborations/collaboration-draft-service.js";
import { renderCollaborationCard } from "../application/collaborations/collaboration-renderer.js";
import { CollaborationPublicationService, CollaborationNotPublishableError, PublicationUnavailableError } from "../application/collaborations/collaboration-publication-service.js";
import {
	BrowseSessionStaleError,
	CollaborationBrowseService,
	type BrowseFilterDimension,
	type BrowseFilterValue,
	type BrowsePage,
} from "../application/collaborations/collaboration-browse-service.js";
import type { BrowseCollaborationRecord, BrowseSessionRecord } from "../application/ports/collaboration-browse-repository.js";
import type {
	ApplicationService,
	ApplicationFailureCode,
} from "../application/applications/application-service.js";
import type { CollaborationDraftInput, CollaborationDraftState, CollaborationWizardStep } from "../domain/collaborations/collaboration.js";
import type { ProfileInput } from "../domain/profiles/profile.js";
import { DomainValidationError, parseCollaborationFormat, parsePlatformType, parseProfileType, parseTargetProfileType, parseTopic, type CollaborationFormat, type PlatformType, type ProfileType, type Topic } from "../domain/value-objects/enums.js";

const PROFILE_STATIC_CALLBACKS = new Set(["menu:home", "profile:create", "profile:resume", "profile:view", "profile:edit", "profile:unavailable", "collaboration:start", "collaboration:resume", "collaboration:own", "application:own", "browse:start"]);
const CALLBACK_ACTION_TTL_MS = 24 * 60 * 60 * 1_000;
const PROFILE_LINK_PROMPT = "Добавьте публичную площадку. Она будет видна другим пользователям до принятия отклика.";
const PROFILE_LINK_CHOICE_HINT = "Выберите личный Telegram-профиль или Telegram-канал. Для другой публичной площадки нажмите «Указать другую ссылку».";
const PROFILE_TYPE_LABELS: Record<ProfileType, string> = {
	blogger: "Блогер",
	telegram_channel: "Telegram-канал",
	venue_or_brand: "Заведение или бренд",
};
const PROFILE_TYPE_INPUTS = new Map<string, ProfileType>([
	["blogger", "blogger"], ["блогер", "blogger"],
	["telegram_channel", "telegram_channel"], ["telegram-канал", "telegram_channel"], ["телеграм-канал", "telegram_channel"],
	["venue_or_brand", "venue_or_brand"], ["заведение или бренд", "venue_or_brand"],
]);
const TOPIC_LABELS: Record<Topic, string> = {
	lifestyle: "Lifestyle",
	food: "Еда и рестораны",
	beauty: "Красота",
	travel: "Путешествия",
	city: "Город",
	events: "События",
	family: "Семья",
	sport: "Спорт",
	business: "Бизнес",
	other: "Другое",
};
const TOPIC_INPUTS = new Map<string, Topic>([
	["lifestyle", "lifestyle"], ["лайфстайл", "lifestyle"],
	["food", "food"], ["еда", "food"], ["еда и рестораны", "food"],
	["beauty", "beauty"], ["красота", "beauty"],
	["travel", "travel"], ["путешествия", "travel"],
	["city", "city"], ["город", "city"],
	["events", "events"], ["события", "events"],
	["family", "family"], ["семья", "family"],
	["sport", "sport"], ["спорт", "sport"],
	["business", "business"], ["бизнес", "business"],
	["other", "other"], ["другое", "other"],
]);
const COLLABORATION_FORMAT_LABELS: Record<CollaborationFormat, string> = {
	advertising_integration: "Рекламная интеграция",
	barter: "Бартер",
	joint_giveaway: "Совместный розыгрыш",
	joint_content: "Совместный контент",
	mutual_pr: "Взаимопиар",
	event: "Мероприятие",
	other: "Другое",
};
type ProfileMutationKind = "back" | "cancel" | "apply" | "type" | "platform" | "omit";
interface ProfileMutationCallback {
	readonly kind: ProfileMutationKind;
	readonly value?: string;
	readonly generation: string;
	readonly revision: number;
}
type CollaborationMutationKind = "format" | "target" | "back" | "cancel" | "preview" | "publish";
interface CollaborationMutation {
	readonly kind: CollaborationMutationKind;
	readonly value?: string;
	readonly generation: string;
	readonly revision: number;
}
type BrowseMutationKind = "next" | "reset" | "filters" | "filter" | "set";
interface BrowseMutation {
	readonly kind: BrowseMutationKind;
	readonly dimension?: "target" | "format" | "topic";
	readonly value?: string;
	readonly generation: string;
	readonly revision: number;
}
interface ApplicationStart {
	readonly publicToken: string;
	readonly source: "feed" | "deep_link";
}
type SessionToken = { readonly generation: string; readonly revision: number };
type SessionIdentity = ProfileSessionRecord | SessionToken;
type ApplicationContinuation = Extract<NonNullable<ProfileSessionState["continuation"]>, { readonly kind: "submit_application" }>;
type ApplicationProfileState = ProfileSessionState & { readonly continuation: ApplicationContinuation };
type ApplicationProfileSession = ProfileSessionRecord & { readonly state: ApplicationProfileState };

export interface ProfileBotOptions {
	readonly profileService: ProfileService;
	readonly sessionRepository: ProfileSessionRepository;
	readonly telegramUserRepository: TelegramUserWriter & {
		findByTelegramUserId(telegramUserId: string): Promise<{ status: "active" | "blocked" } | undefined>;
	};
	readonly durableCommandExecutor: DurableCommandExecutor;
	readonly clock: Clock;
	readonly helpContact: string;
	readonly requestIdFactory?: () => number;
	readonly collaborationDraftService?: CollaborationDraftService;
	readonly collaborationPublicationService?: CollaborationPublicationService;
	readonly collaborationBrowseService?: CollaborationBrowseService;
	readonly applicationService?: ApplicationService;
	readonly callbackActionService?: CallbackActionService;
}

export interface RegisteredProfileBot {
	readonly profileService: ProfileService;
}

export function registerProfileBot(bot: Bot, options: ProfileBotOptions): RegisteredProfileBot {
	const requestIdFactory = options.requestIdFactory ?? (() => randomInt(1, 2_147_483_647));

	bot.on("message", async (ctx) => {
		const message = ctx.message;
		await runDurable(ctx, options, { kind: "message", text: message.text ?? "", hasChatShared: message.chat_shared !== undefined }, async (workCtx) => {
			if (workCtx.chat?.type !== "private" || workCtx.from === undefined) return;
			if (!(await ensureActor(workCtx, options))) return;
			const userId = String(workCtx.from.id);
			if (message.chat_shared !== undefined) {
				await handleChatShared(workCtx, options, userId, message.chat_shared);
				return;
			}
			if (message.text !== undefined) await handleText(workCtx, options, userId, message.text);
		});
	});

	bot.on("callback_query:data", async (ctx) => {
		const callbackQuery = ctx.callbackQuery;
		const data = callbackQuery.data;
		if (data.startsWith("cb_")) {
			await handleOpaqueCallback(ctx, options, data);
			return;
		}
		await runDurable(ctx, options, { kind: "callback_query", data }, async (workCtx) => {
			if (callbackQuery.message?.chat.type !== "private" || workCtx.from === undefined) {
				await workCtx.answerCallbackQuery();
				return;
			}
			if (!(await ensureActor(workCtx, options))) {
				await workCtx.answerCallbackQuery();
				return;
			}
			await workCtx.answerCallbackQuery();
			const mutation = parseProfileMutationCallback(data);
			const collaborationMutation = parseCollaborationMutationCallback(data);
			const browseMutation = parseBrowseMutation(data);
			const applicationStart = parseApplicationStart(data);
			if (!PROFILE_STATIC_CALLBACKS.has(data) && mutation === undefined && collaborationMutation === undefined && browseMutation === undefined && applicationStart === undefined) return;
			const userId = String(workCtx.from.id);
			if (mutation !== undefined) {
				switch (mutation.kind) {
					case "back":
						await backSession(workCtx, options, userId, mutation);
						return;
					case "cancel":
						await cancelSession(workCtx, options, userId, mutation);
						return;
					case "apply":
						await apply(workCtx, options, userId, mutation);
						return;
					case "type":
						await chooseType(workCtx, options, userId, mutation.value ?? "", mutation);
						return;
					case "platform":
						await choosePlatform(workCtx, options, userId, mutation.value ?? "", requestIdFactory, mutation);
						return;
					case "omit":
						await omitOptional(workCtx, options, userId, mutation);
						return;
				}
			}
			if (collaborationMutation !== undefined) {
				await handleCollaborationMutation(workCtx, options, userId, collaborationMutation);
				return;
			}
			if (browseMutation !== undefined) {
				await handleBrowseMutation(workCtx, options, userId, browseMutation);
				return;
			}
			if (applicationStart !== undefined) {
				await handleApplicationStart(workCtx, options, userId, applicationStart);
				return;
			}
			switch (data) {
			case "menu:home":
				await renderMenu(workCtx, options, userId);
				return;
			case "profile:create":
				await startOrResume(workCtx, options, userId, false);
				return;
			case "profile:resume":
				await resume(workCtx, options, userId);
				return;
			case "profile:view":
				await showProfile(workCtx, options, userId);
				return;
			case "profile:edit":
				await startOrResume(workCtx, options, userId, true);
				return;
			case "profile:unavailable":
				await workCtx.reply("Этот раздел пока готовится. Сейчас вы можете создать и отредактировать профиль.", { reply_markup: menuKeyboard(options) });
				return;
			case "collaboration:start":
			case "collaboration:resume":
				await startOrResumeCollaboration(workCtx, options, userId);
				return;
			case "collaboration:own":
				await renderOwnCollaborations(workCtx, options, userId);
				return;
			case "application:own":
				await renderOwnApplications(workCtx, options, userId);
				return;
			case "browse:start":
				await openFeed(workCtx, options, userId);
				return;
			default:
				if (data.startsWith("profile:type:")) {
					await chooseType(workCtx, options, userId, data.slice("profile:type:".length));
					return;
				}
				if (data.startsWith("profile:platform:")) {
					await choosePlatform(workCtx, options, userId, data.slice("profile:platform:".length), requestIdFactory);
				}
			}
		});
	});

	return { profileService: options.profileService };
}

async function handleText(ctx: Context, options: ProfileBotOptions, userId: string, text: string): Promise<void> {
	const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
	if (command === "/start") {
		const startParameter = text.trim().slice(command.length).trim();
		if (startParameter.startsWith("c_")) {
			await renderDeepLink(ctx, options, userId, startParameter);
			return;
		}
		await renderMenu(ctx, options, userId);
		return;
	}
	if (command === "/help") {
		await ctx.reply(`«Давай вместе» помогает блогерам, Telegram-каналам, заведениям и брендам находить партнёров для совместных проектов.\n\nСейчас сервис работает в Екатеринбурге. Вы можете создать и отредактировать свой профиль. По вопросам работы бота: ${options.helpContact}`);
		return;
	}
	if (command === "/cancel") {
		if (options.collaborationDraftService !== undefined && (await options.collaborationDraftService.findSession(userId) !== undefined || await options.collaborationDraftService.findDraft(userId) !== undefined)) {
			await options.collaborationDraftService.cancel(userId);
			await ctx.reply("Черновик коллаборации отменён.", { reply_markup: menuKeyboard(options) });
			return;
		}
		const profileSession = await activeSession(options, userId);
		await options.sessionRepository.delete(userId);
		await ctx.reply(
			isApplicationSession(profileSession) ? "Отклик отменён. Сохранённый профиль не изменён." : "Заполнение профиля отменено.",
			{ reply_markup: menuKeyboard(options) },
		);
		return;
	}
	if (command === "/new") {
		await startOrResumeCollaboration(ctx, options, userId);
		return;
	}
	if (command === "/my_collaborations") {
		await renderOwnCollaborations(ctx, options, userId);
		return;
	}
	if (command === "/my_applications" || command === "/my_apps") {
		await renderOwnApplications(ctx, options, userId);
		return;
	}
	if (command === "/feed") {
		await openFeed(ctx, options, userId);
		return;
	}
	if (command === "/profile") {
		const session = await activeSession(options, userId);
		if (session !== undefined) {
			await ctx.reply("У вас есть незавершённое заполнение профиля.", { reply_markup: resumeKeyboard(session) });
			return;
		}
		await showProfile(ctx, options, userId);
		return;
	}

	const session = await activeSession(options, userId);
	if (session === undefined) {
		const collaborationSession = options.collaborationDraftService === undefined ? undefined : await options.collaborationDraftService.findSession(userId);
		if (collaborationSession !== undefined) {
			await advanceCollaborationText(ctx, options, userId, collaborationSession, text);
			return;
		}
		await ctx.reply("Не удалось распознать команду. Откройте главное меню командой /start или воспользуйтесь /help.", { reply_markup: menuKeyboard(options) });
		return;
	}
	await advanceText(ctx, options, userId, session, text);
}

type ReplyOptions = Parameters<Context["reply"]>[1];
type AnswerOptions = Parameters<Context["answerCallbackQuery"]>[0];
interface ReplyAction {
	readonly text: string;
	readonly options?: ReplyOptions;
}

class ReplyCollector {
	readonly replies: ReplyAction[] = [];
	readonly answers: AnswerOptions[] = [];

	context(ctx: Context): Context {
		const proxy = Object.create(ctx) as Context;
		proxy.reply = async (text: string, options?: ReplyOptions) => {
			if (options === undefined) this.replies.push({ text });
			else this.replies.push({ text, options });
			return undefined as never;
		};
		proxy.answerCallbackQuery = async (options?: AnswerOptions) => {
			if (options !== undefined) this.answers.push(options);
			else this.answers.push(undefined as never);
			return true;
		};
		return proxy;
	}
}

async function runDurable(
	ctx: Context,
	options: ProfileBotOptions,
	input: CanonicalInput,
	effect: (workContext: Context) => Promise<void>,
): Promise<void> {
	const updateId = getUpdateId(ctx.update);
	const from = ctx.from;
	if (updateId === undefined || from === undefined) return;
	const collector = new ReplyCollector();
	const workContext = collector.context(ctx);
	await options.durableCommandExecutor.execute({
		context: {
			commandId: `telegram:update:${updateId}`,
			telegramUpdateId: updateId,
			actor: { kind: "telegram_user", telegramUserId: String(from.id) },
			occurredAt: telegramOccurredAt(ctx.update),
		},
		input,
		effect: async () => {
			await effect(workContext);
			return { version: 1, outcome: "completed", messageKey: "command_completed" };
		},
	});
	const inputRecord = input !== null && typeof input === "object" && !Array.isArray(input) ? input as { readonly kind?: unknown } : undefined;
	if (collector.replies.length === 0 && collector.answers.length === 0 && inputRecord?.kind === "callback_query") {
		await ctx.answerCallbackQuery();
		const session = await activeSession(options, String(from.id));
		if (session !== undefined) await ctx.reply("Запрос уже обработан. Текущий шаг сохранён.", { reply_markup: resumeKeyboard(session) });
		else if (await options.profileService.getOwn(String(from.id)) !== undefined) await ctx.reply("Запрос уже обработан. Профиль уже сохранён.", { reply_markup: menuKeyboard(options) });
		else await ctx.reply("Запрос уже обработан.", { reply_markup: menuKeyboard(options) });
		return;
	}
	for (const answer of collector.answers) {
		if (answer === undefined) await ctx.answerCallbackQuery();
		else await ctx.answerCallbackQuery(answer);
	}
	for (const reply of collector.replies) {
		if (reply.options === undefined) await ctx.reply(reply.text);
		else await ctx.reply(reply.text, reply.options);
	}
}

async function handleOpaqueCallback(ctx: Context, options: ProfileBotOptions, callbackPayload: string): Promise<void> {
	const from = ctx.from;
	const updateId = getUpdateId(ctx.update);
	if (ctx.callbackQuery?.message?.chat.type !== "private" || from === undefined || updateId === undefined) {
		await ctx.answerCallbackQuery();
		return;
	}
	const callbackActions = options.callbackActionService;
	const applications = options.applicationService;
	if (callbackActions === undefined || applications === undefined) {
		await ctx.answerCallbackQuery();
		await ctx.reply("Действие сейчас недоступно или уже неактуально.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const userId = String(from.id);
	const occurredAt = telegramOccurredAt(ctx.update);
	const result = await callbackActions.invoke({
		context: {
			commandId: `telegram:update:${updateId}`,
			telegramUpdateId: updateId,
			actor: { kind: "telegram_user", telegramUserId: userId },
			occurredAt,
		},
		callbackPayload,
		effect: async (action): Promise<SafeResult> => {
			await upsertActorSnapshot(ctx, options);
			if (action.actionType === "application.accept" || action.actionType === "application.reject") {
				const applicationId = parseCallbackEntity(action.entityId, "application");
				if (applicationId === undefined) return callbackConflict();
				const decision = await applications.decide({
					telegramUserId: userId,
					applicationId,
					decision: action.actionType === "application.accept" ? "accept" : "reject",
					occurredAt: occurredAt.getTime(),
				});
				return decision.ok
					? { version: 1, outcome: "completed", messageKey: "command_completed", entityId: decision.collaborationId, referenceId: decision.applicationId }
					: callbackConflict();
			}
			if (action.actionType === "collaboration.close") {
				const collaborationId = parseCallbackEntity(action.entityId, "collaboration");
				if (collaborationId === undefined) return callbackConflict();
				const completion = await applications.completeRecruitment({
					telegramUserId: userId,
					collaborationId,
					occurredAt: occurredAt.getTime(),
				});
				return completion.ok
					? { version: 1, outcome: "completed", messageKey: "command_completed", entityId: completion.collaborationId }
					: callbackConflict();
			}
			return callbackConflict();
		},
	});
	await ctx.answerCallbackQuery();
	if ((result.outcome === "completed" || result.outcome === "ok") && result.entityId !== undefined) {
		const management = await applications.getAuthorManagement(userId, result.entityId);
		if (management !== undefined) {
			await renderAuthorManagement(ctx, options, userId, management);
			return;
		}
		await ctx.reply("Решение сохранено.", { reply_markup: menuKeyboard(options) });
		return;
	}
	if (result.outcome === "stale") {
		await ctx.reply("Эта кнопка устарела и больше неактуальна. Откройте карточку заново.", { reply_markup: menuKeyboard(options) });
		return;
	}
	if (result.outcome === "expired") {
		await ctx.reply("Срок действия этой кнопки истёк. Откройте карточку заново.", { reply_markup: menuKeyboard(options) });
		return;
	}
	await ctx.reply("Действие недоступно или уже неактуально.", { reply_markup: menuKeyboard(options) });
}

function callbackConflict(): SafeResult {
	return { version: 1, outcome: "conflict", messageKey: "callback_unavailable" };
}

function parseCallbackEntity(value: string | null, kind: "application" | "collaboration"): string | undefined {
	if (value === null || !value.startsWith(`${kind}:`)) return undefined;
	const id = value.slice(kind.length + 1);
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
}

async function handleChatShared(ctx: Context, options: ProfileBotOptions, userId: string, shared: { request_id: number; chat_id: number | string; title?: string; username?: string }): Promise<void> {
	const session = await activeSession(options, userId);
	if (session === undefined || session.state.step !== "platform" || session.state.requestId !== shared.request_id) {
		await ctx.reply("Эта кнопка выбора канала уже неактуальна. Вернитесь к профилю и выберите канал ещё раз.");
		return;
	}
	if (shared.username === undefined) {
		const saved = await saveState(options, userId, withoutRequestId({ ...session.state, step: "platform_url", draft: { ...session.state.draft, platform: { platformType: "telegram", url: "https://t.me/manual" } } }));
		await ctx.reply("Telegram не передал публичное имя канала. Отправьте ссылку вида https://t.me/channel_name.", { reply_markup: cancelKeyboard(saved) });
		return;
	}
	const username = normalizeTelegramUsername(shared.username);
	if (username === undefined) {
		await ctx.reply("Не удалось распознать публичное имя канала. Отправьте ссылку вида https://t.me/channel_name.");
		return;
	}
	const platform = {
		platformType: "telegram" as const,
		url: `https://t.me/${username}`,
		username,
		telegramChatId: String(shared.chat_id),
		...(shared.title === undefined ? {} : { title: shared.title }),
	};
	if (isApplicationState(session.state)) {
		await finishQuickApplicationProfile(ctx, options, userId, withoutRequestId({ ...session.state, draft: { ...session.state.draft, platform } }));
		return;
	}
	const saved = await saveState(options, userId, withoutRequestId({ version: PROFILE_SESSION_VERSION, generation: session.state.generation, step: "audience", draft: { ...session.state.draft, platform } }));
	await renderStep(ctx, options, userId, saved);
}

async function advanceText(ctx: Context, options: ProfileBotOptions, userId: string, session: ProfileSessionRecord, text: string): Promise<void> {
	const state = session.state;
	const value = text.trim();
	if (isApplicationState(state) && ["назад", "← назад", "back"].includes(value.toLowerCase())) {
		await backSession(ctx, options, userId, sessionToken(session));
		return;
	}
	switch (state.step) {
		case "type":
			await chooseType(ctx, options, userId, value);
			return;
		case "display_name": {
			if (value.length < 2 || value.length > 100) {
				await ctx.reply("Название должно быть длиной от 2 до 100 символов.");
				return;
			}
			const saved = await saveState(options, userId, {
				...state,
				step: isApplicationState(state) ? "platform" : "topics",
				draft: { ...state.draft, displayName: value },
			});
			await renderStep(ctx, options, userId, saved);
			return;
		}
		case "topics": {
			if (value === "-") {
				await omitOptionalFromSession(ctx, options, userId, session);
				return;
			}
			const topics = parseTopics(value);
			if (topics === undefined) {
				await ctx.reply("Выберите до 3 разных тем из предложенного списка или отправьте `-`.", { reply_markup: optionalKeyboard(session, hasTopics(state.draft)) });
				return;
			}
			const saved = await saveState(options, userId, { ...state, step: "description", draft: { ...state.draft, topics } });
			await renderStep(ctx, options, userId, saved);
			return;
		}
		case "description": {
			if (value === "-") {
				await omitOptionalFromSession(ctx, options, userId, session);
				return;
			}
			if (value.length < 10 || value.length > 500) {
				await ctx.reply("Описание должно быть длиной от 10 до 500 символов или отправьте `-`.", { reply_markup: optionalKeyboard(session, state.draft.description !== undefined && state.draft.description !== null) });
				return;
			}
			const saved = await saveState(options, userId, { ...state, step: "platform", draft: { ...state.draft, description: value } });
			await ctx.reply(PROFILE_LINK_PROMPT, { reply_markup: platformKeyboard(saved, ctx.from?.username) });
			return;
		}
		case "platform":
			if (value === "Указать другую ссылку" || value === "Ввести ссылку вручную" || value.toLowerCase() === "manual") {
				const saved = await saveState(options, userId, { ...state, step: "platform_url", draft: withoutPlatform(state.draft) });
				await ctx.reply("Укажите другую публичную ссылку в формате https://...", { reply_markup: cancelKeyboard(saved) });
				return;
			}
			if (isAbsoluteHttps(value)) {
				await acceptPlatformUrl(ctx, options, userId, state, value);
				return;
			}
			await choosePlatform(ctx, options, userId, value, options.requestIdFactory ?? (() => randomInt(1, 2_147_483_647)));
			return;
		case "platform_url":
			await acceptPlatformUrl(ctx, options, userId, state, value);
			return;
		case "audience": {
			if (value === "-") {
				await omitOptionalFromSession(ctx, options, userId, session);
				return;
			}
			if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
				await ctx.reply("Размер аудитории должен быть неотрицательным числом или `-`.");
				return;
			}
			const platform = state.draft.platform;
			if (platform === undefined) {
				await ctx.reply("Площадка не выбрана. Начните заполнение заново.");
				return;
			}
			await saveState(options, userId, { ...state, step: "review", draft: { ...state.draft, platform: { ...platform, audienceSize: Number(value) } } });
			await renderReview(ctx, options, userId);
			return;
		}
		case "review":
			await ctx.reply("Проверьте данные и сохраните профиль либо отмените заполнение.", { reply_markup: reviewKeyboard(session) });
			return;
		case "application_message":
			if (!isApplicationSession(session)) {
				await ctx.reply("Сохранённое заполнение повреждено. Начните отклик заново.", { reply_markup: menuKeyboard(options) });
				return;
			}
			await submitApplicationMessage(ctx, options, userId, session, value);
			return;
	}
}

async function omitOptional(ctx: Context, options: ProfileBotOptions, userId: string, expected: SessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	await omitOptionalFromSession(ctx, options, userId, session);
}

async function omitOptionalFromSession(ctx: Context, options: ProfileBotOptions, userId: string, session: ProfileSessionRecord): Promise<void> {
	const state = session.state;
	let saved: ProfileSessionRecord;
	switch (state.step) {
		case "topics":
			saved = await saveState(options, userId, { ...state, step: "description", draft: { ...state.draft, topics: [] } });
			break;
		case "description":
			saved = await saveState(options, userId, { ...state, step: "platform", draft: { ...state.draft, description: null } });
			break;
		case "audience": {
			const platform = state.draft.platform;
			if (platform === undefined) {
				await ctx.reply("Площадка не выбрана. Начните заполнение заново.");
				return;
			}
			saved = await saveState(options, userId, { ...state, step: "review", draft: { ...state.draft, platform: withoutAudience(platform) } });
			break;
		}
		default:
			await ctx.reply("Эту часть профиля нельзя пропустить. Продолжите с текущего шага.", { reply_markup: resumeKeyboard(session) });
			return;
	}
	await renderStep(ctx, options, userId, saved);
}

async function cancelSession(ctx: Context, options: ProfileBotOptions, userId: string, expected: SessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	await options.sessionRepository.delete(userId);
	await ctx.reply(
		isApplicationSession(session) ? "Отклик отменён. Сохранённый профиль не изменён." : "Заполнение профиля отменено.",
		{ reply_markup: menuKeyboard(options) },
	);
}

async function backSession(ctx: Context, options: ProfileBotOptions, userId: string, expected: SessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	if (!isApplicationSession(session)) {
		await ctx.reply("Назад можно вернуться только из короткого заполнения отклика.", { reply_markup: resumeKeyboard(session) });
		return;
	}
	const state = session.state;
	switch (state.step) {
		case "display_name": {
			const saved = await saveState(options, userId, withoutRequestId({
				...state,
				step: "type",
				draft: { description: null, topics: [] },
			}));
			await renderStep(ctx, options, userId, saved);
			return;
		}
		case "platform":
		case "platform_url": {
			const saved = await saveState(options, userId, withoutRequestId({
				...state,
				step: "display_name",
				draft: withoutPlatform(state.draft),
			}));
			await renderStep(ctx, options, userId, saved);
			return;
		}
		case "type":
			await options.sessionRepository.delete(userId);
			await ctx.reply("Короткое заполнение отменено.", { reply_markup: menuKeyboard(options) });
			return;
		case "application_message":
			await options.sessionRepository.delete(userId);
			await reopenApplicationCard(ctx, options, userId, state.continuation.collaborationId);
			return;
		default:
			await ctx.reply("Продолжите с текущего шага.", { reply_markup: applicationNavigationKeyboard(session) });
	}
}

async function chooseType(ctx: Context, options: ProfileBotOptions, userId: string, raw: string, expected?: SessionToken): Promise<void> {
		let type: ProfileType;
		const session = expected === undefined ? await activeSession(options, userId) : await sessionAtRevision(ctx, options, userId, expected);
		if (session === undefined) return;
		try { type = PROFILE_TYPE_INPUTS.get(raw.trim().toLowerCase()) ?? parseProfileType(raw); } catch { await ctx.reply("Выберите один из предложенных вариантов.", { reply_markup: typeKeyboard(session) }); return; }
		const draft = session?.state.draft ?? {};
		const saved = await saveState(options, userId, withoutRequestId({ version: PROFILE_SESSION_VERSION, generation: session.state.generation, step: "display_name", draft: { ...draft, type }, ...(session.state.continuation === undefined ? {} : { continuation: session.state.continuation }) }));
		await renderStep(ctx, options, userId, saved);
}

async function choosePlatform(ctx: Context, options: ProfileBotOptions, userId: string, raw: string, requestIdFactory: () => number, expected?: SessionToken): Promise<void> {
		let platformType: PlatformType;
		const session = expected === undefined ? await activeSession(options, userId) : await sessionAtRevision(ctx, options, userId, expected);
		if (session === undefined) { await ctx.reply("Не удалось найти сохранённое заполнение. Откройте «👤 Мой профиль» и начните заново."); return; }
		if (raw === "self") {
			const username = ctx.from?.username === undefined ? undefined : normalizeTelegramUsername(ctx.from.username);
			if (username === undefined) {
				await ctx.reply("Telegram не передал публичного @username. Выберите Telegram-канал или укажите другую публичную ссылку.", { reply_markup: platformKeyboard(session) });
				return;
			}
			const platform = { platformType: "telegram" as const, url: `https://t.me/${username}`, username };
			if (isApplicationState(session.state)) {
				await finishQuickApplicationProfile(ctx, options, userId, withoutRequestId({ ...session.state, draft: { ...session.state.draft, platform } }));
				return;
			}
			const saved = await saveState(options, userId, withoutRequestId({ ...session.state, step: "audience", draft: { ...session.state.draft, platform } }));
			await renderStep(ctx, options, userId, saved);
			return;
		}
		try { platformType = parsePlatformType(raw); } catch { await ctx.reply(PROFILE_LINK_CHOICE_HINT, { reply_markup: platformKeyboard(session, ctx.from?.username) }); return; }
		if (platformType === "telegram") {
			const requestId = uniqueRequestId(requestIdFactory(), session.state.requestId);
			await saveState(options, userId, { ...session.state, step: "platform", requestId });
			const keyboard = new Keyboard().requestChat("Выбрать Telegram-канал", requestId, { chat_is_channel: true, request_title: true, request_username: true }).row().text("Указать другую ссылку");
			if (isApplicationState(session.state)) keyboard.row().text("← Назад").text("/cancel");
			keyboard.resized();
			await ctx.reply(PROFILE_LINK_CHOICE_HINT, { reply_markup: keyboard });
			return;
		}
		const saved = await saveState(options, userId, withoutRequestId({ ...session.state, step: "platform_url", draft: withoutPlatform(session.state.draft) }));
		await ctx.reply("Укажите другую публичную ссылку в формате https://...", { reply_markup: cancelKeyboard(saved) });
}

async function acceptPlatformUrl(ctx: Context, options: ProfileBotOptions, userId: string, state: ProfileSessionState, value: string): Promise<void> {
		if (!isAbsoluteHttps(value)) { await ctx.reply("Нужна абсолютная ссылка https://..."); return; }
		const username = telegramUsernameFromUrl(value);
		if (isTelegramHost(value) && username === undefined) {
			await ctx.reply("Нужна публичная ссылка вида https://t.me/channel_name. Приглашения в закрытые каналы не подходят.");
			return;
		}
		const platform = username === undefined
			? { platformType: "other" as const, url: value }
			: { platformType: "telegram" as const, url: `https://t.me/${username}`, username };
		if (isApplicationState(state)) {
			await finishQuickApplicationProfile(ctx, options, userId, withoutRequestId({ ...state, draft: { ...state.draft, platform } }));
			return;
		}
		const saved = await saveState(options, userId, withoutRequestId({ ...state, step: "audience", draft: { ...state.draft, platform } }));
		await renderStep(ctx, options, userId, saved);
}

async function apply(ctx: Context, options: ProfileBotOptions, userId: string, expected: SessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	const input = toProfileInput(session.state.draft);
	if (input === undefined) { await ctx.reply("Не все поля заполнены. Продолжите заполнение.", { reply_markup: resumeKeyboard(session) }); return; }
	let existing;
	try {
		existing = await options.profileService.getOwn(userId);
		if (existing === undefined) await options.profileService.create(userId, input);
		else await options.profileService.update(userId, input);
	} catch (error) {
		if (error instanceof Error && error.name === "DomainValidationError") {
			await ctx.reply("Проверьте данные профиля и попробуйте ещё раз.", { reply_markup: resumeKeyboard(session) });
			return;
		}
		throw error;
	}
	const continuation = session.state.continuation;
	await options.sessionRepository.delete(userId);
	if (continuation?.kind === "create_collaboration" && options.collaborationDraftService !== undefined) {
		try {
			const started = await options.collaborationDraftService.start(userId);
			await ctx.reply("Профиль сохранён. Продолжим создание коллаборации.");
			await renderCollaborationStep(ctx, options, userId, started);
			return;
		} catch (error) {
			if (!(error instanceof CollaborationProfileRequiredError)) throw error;
		}
	}
	await ctx.reply("Готово — профиль сохранён.", { reply_markup: menuKeyboard(options) });
}

async function showProfile(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const profile = await options.profileService.getOwn(userId);
	if (profile === undefined) {
		await ctx.reply("У вас пока нет профиля. Создайте его, чтобы представиться будущим партнёрам.", { reply_markup: new InlineKeyboard().text("➕ Создать профиль", "profile:create") });
		return;
	}
	const platform = profile.platforms[0];
	const lines = [
		"Ваш профиль",
		"",
		`Название: ${profile.displayName}`,
		`Кто вы: ${profileTypeLabel(profile.type)}`,
		...(profile.description === null ? [] : [`Описание: ${profile.description}`]),
		...(profile.topics.length === 0 ? [] : [`Темы: ${profile.topics.map(topicLabel).join(", ")}`]),
		`Площадка: ${platform?.url ?? "не указана"}`,
		...(platform?.audienceSize === undefined ? [] : [`Аудитория: ${platform.audienceSize}`]),
	];
	await ctx.reply(lines.join("\n"), { reply_markup: new InlineKeyboard().text("✏️ Изменить профиль", "profile:edit").row().text("← В главное меню", "menu:home") });
}

async function startOrResume(ctx: Context, options: ProfileBotOptions, userId: string, edit: boolean, continuation?: ProfileSessionState["continuation"]): Promise<void> {
	if (options.collaborationDraftService !== undefined && (await options.collaborationDraftService.findSession(userId) !== undefined || await options.collaborationDraftService.findDraft(userId) !== undefined)) {
		await ctx.reply("Сначала завершите или отмените заполнение коллаборации.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const current = await options.sessionRepository.findActive(userId, now(options.clock));
	if (current !== undefined) { await renderStep(ctx, options, userId, current); return; }
	if (!edit && await options.profileService.getOwn(userId) !== undefined) {
		await ctx.reply("Профиль уже создан. При необходимости обновите его.", { reply_markup: new InlineKeyboard().text("✏️ Изменить профиль", "profile:edit") });
		return;
	}
	const profile = edit ? await options.profileService.getOwn(userId) : undefined;
	const firstPlatform = profile?.platforms[0];
	const draft: ProfileDraft = profile === undefined ? {} : {
		type: profile.type,
		displayName: profile.displayName,
		description: profile.description,
		topics: profile.topics,
		...(firstPlatform === undefined ? {} : { platform: firstPlatform }),
	};
	const saved = await saveState(options, userId, { version: PROFILE_SESSION_VERSION, generation: createSessionGeneration(), step: "type", draft, ...(continuation === undefined ? {} : { continuation }) });
	await ctx.reply(edit ? "Начнём обновление профиля. Выберите, кто вы:" : "Давайте создадим профиль. Выберите, кто вы:", { reply_markup: typeKeyboard(saved) });
}

async function resume(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	if (session === undefined) { await startOrResume(ctx, options, userId, false); return; }
	await renderStep(ctx, options, userId, session);
}

async function startOrResumeCollaboration(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const service = options.collaborationDraftService;
	if (service === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const profileSession = await activeSession(options, userId);
	if (profileSession !== undefined) {
		await ctx.reply("Сначала завершите заполнение профиля — после сохранения продолжим создание коллаборации.", { reply_markup: resumeKeyboard(profileSession) });
		return;
	}
	if (await options.profileService.getOwn(userId) === undefined) {
		await ctx.reply("Чтобы создать коллаборацию, сначала заполним короткий профиль.");
		await startOrResume(ctx, options, userId, false, { kind: "create_collaboration" });
		return;
	}
	try {
		const started = await service.start(userId);
		await renderCollaborationStep(ctx, options, userId, started);
	} catch (error) {
		if (error instanceof CollaborationWizardConflictError) {
			await ctx.reply("Сначала завершите уже открытое заполнение.", { reply_markup: menuKeyboard(options) });
			return;
		}
		throw error;
	}
}

async function renderCollaborationStep(ctx: Context, options: ProfileBotOptions, _userId: string, started: CollaborationDraftStartResult): Promise<void> {
	const session = started.session;
	const state = session.state;
	const markup = collaborationKeyboard(state, session.revision, options);
	if (state.step === "preview") {
		await ctx.reply(renderCollaborationCard(state), { parse_mode: "HTML", reply_markup: markup });
		return;
	}
	const prompts: Record<Exclude<CollaborationWizardStep, "preview">, string> = {
		format: "Выберите формат коллаборации:",
		target_profile_type: "Кого вы ищете в партнёры?",
		topics: "Выберите от 1 до 3 тем для этой коллаборации. Они могут отличаться от тем вашего профиля.\n\nДоступные темы: Lifestyle, Еда и рестораны, Красота, Путешествия, Город, События, Семья, Спорт, Бизнес, Другое.\n\nОтправьте названия через запятую. Например: Бизнес, Город.",
		title: "Придумайте название коллаборации (5–100 символов).",
		offer: "Что вы предлагаете партнёру? (10–1000 символов)",
		expectation: "Что вы ожидаете от партнёра? (10–1000 символов)",
		slots: "Сколько партнёров нужно? Укажите число от 1 до 10.",
		deadline: "До какой даты принимаете отклики? Формат DD.MM.YYYY, не дальше 90 дней.",
		event_date: "Когда состоится коллаборация? Формат DD.MM.YYYY или отправьте `-`.",
	};
	await ctx.reply(prompts[state.step], { reply_markup: markup });
}

async function advanceCollaborationText(ctx: Context, options: ProfileBotOptions, userId: string, session: NonNullable<Awaited<ReturnType<CollaborationDraftService["findSession"]>>>, text: string): Promise<void> {
	const service = options.collaborationDraftService;
	if (service === undefined) return;
	const value = text.trim();
	let input: CollaborationDraftInput;
	let nextStep: CollaborationWizardStep;
	try {
		switch (session.state.step) {
			case "topics": {
				const topics = parseCollaborationTopics(value);
				if (topics === undefined) throw new DomainValidationError("topics are invalid");
				input = { topics }; nextStep = "title"; break;
			}
			case "title": input = { title: value }; nextStep = "offer"; break;
			case "offer": input = { offerText: value }; nextStep = "expectation"; break;
			case "expectation": input = { expectationText: value }; nextStep = "slots"; break;
			case "slots": {
				if (!/^\d+$/.test(value)) throw new DomainValidationError("slots are invalid");
				input = { slotsTotal: Number(value) }; nextStep = "deadline"; break;
			}
			case "deadline": input = { responseDeadlineDate: value }; nextStep = "event_date"; break;
			case "event_date": input = value === "-" ? { eventDateLocal: null } : { eventDateLocal: value }; nextStep = "preview"; break;
			default:
				await renderCollaborationStep(ctx, options, userId, { draft: await service.findDraft(userId) as NonNullable<Awaited<ReturnType<CollaborationDraftService["findDraft"]>>>, session, resumed: true });
				return;
		}
		const saved = await service.saveStep(userId, session, input, nextStep);
		await renderCollaborationStep(ctx, options, userId, saved);
	} catch (error) {
		if (error instanceof DomainValidationError) {
			await ctx.reply("Значение не подходит — исправьте его, предыдущее корректное значение сохранено.", { reply_markup: collaborationKeyboard(session.state, session.revision, options) });
			return;
		}
		if (error instanceof CollaborationDraftStaleError) {
			await ctx.reply("Этот экран уже устарел. Откройте продолжение коллаборации из меню.", { reply_markup: menuKeyboard(options) });
			return;
		}
		throw error;
	}
}

async function handleCollaborationMutation(ctx: Context, options: ProfileBotOptions, userId: string, mutation: CollaborationMutation): Promise<void> {
	const service = options.collaborationDraftService;
	if (service === undefined) return;
	const session = await service.findSession(userId);
	if (session === undefined || session.revision !== mutation.revision || session.state.generation !== mutation.generation) {
		if (mutation.kind === "cancel") {
			if (await service.findDraft(userId) === undefined) await ctx.reply("Этот черновик уже отменён.", { reply_markup: menuKeyboard(options) });
			else await ctx.reply("Этот экран уже устарел. Откройте продолжение коллаборации из меню.", { reply_markup: menuKeyboard(options) });
			return;
		}
		await ctx.reply("Этот экран уже устарел. Откройте продолжение коллаборации из меню.", { reply_markup: menuKeyboard(options) });
		return;
	}
	if (mutation.kind === "cancel") {
		await service.cancel(userId, session);
		await ctx.reply("Черновик коллаборации отменён.", { reply_markup: menuKeyboard(options) });
		return;
	}
	if (mutation.kind === "publish") {
		if (options.collaborationPublicationService === undefined) return;
		try {
			await options.collaborationPublicationService.publish(userId, session.collaborationId);
			await ctx.reply("Публикация запущена.", { reply_markup: menuKeyboard(options) });
		} catch (error) {
			if (error instanceof PublicationUnavailableError) { await ctx.reply("Публикация временно недоступна. Черновик сохранён.", { reply_markup: collaborationKeyboard(session.state, session.revision, options) }); return; }
			if (error instanceof CollaborationNotPublishableError) { await ctx.reply("Карточка уже опубликована или не готова к публикации.", { reply_markup: menuKeyboard(options) }); return; }
			throw error;
		}
		return;
	}
	if (mutation.kind === "back") {
		const previous = previousCollaborationStep(session.state.step);
		if (previous === undefined) {
			await ctx.reply("Черновик сохранён. Вы можете продолжить его из меню.", { reply_markup: menuKeyboard(options) });
			return;
		}
		const saved = await service.saveStep(userId, session, {}, previous);
		await renderCollaborationStep(ctx, options, userId, saved);
		return;
	}
	if (mutation.kind === "preview") {
		try {
			const saved = await service.saveStep(userId, session, {}, "preview");
			await renderCollaborationStep(ctx, options, userId, saved);
		} catch (error) {
			if (error instanceof DomainValidationError) await ctx.reply("Заполните все поля корректно, чтобы открыть предпросмотр.", { reply_markup: collaborationKeyboard(session.state, session.revision, options) });
			else throw error;
		}
		return;
	}
	const next = collaborationCallbackInput(mutation);
	if (next === undefined) return;
	try {
		const saved = await service.saveStep(userId, session, next.input, next.step);
		await renderCollaborationStep(ctx, options, userId, saved);
	} catch (error) {
		if (error instanceof DomainValidationError) await ctx.reply("Выберите корректное значение.", { reply_markup: collaborationKeyboard(session.state, session.revision, options) });
		else throw error;
	}
}

async function renderMenu(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	const keyboard = menuKeyboard(options);
	if (session !== undefined) keyboard.row().text("▶️ Продолжить профиль", "profile:resume");
	if (options.collaborationDraftService !== undefined && (await options.collaborationDraftService.findSession(userId) !== undefined || await options.collaborationDraftService.findDraft(userId) !== undefined)) keyboard.row().text("▶️ Продолжить коллаборацию", "collaboration:resume");
	await ctx.reply("Добро пожаловать в «Давай вместе» — сервис для поиска партнёров и совместных проектов.\n\nСейчас мы начинаем с Екатеринбурга. Выберите, что хотите сделать:", { reply_markup: keyboard });
}

async function renderOwnCollaborations(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	if (options.collaborationPublicationService === undefined) { await ctx.reply("Этот раздел пока готовится.", { reply_markup: menuKeyboard(options) }); return; }
	const summaries = await options.collaborationPublicationService.listOwn(userId);
	const management = options.applicationService === undefined ? [] : await options.applicationService.listAuthorManagement(userId);
	if (summaries.length === 0 && management.length === 0) { await ctx.reply("У вас пока нет коллабораций.", { reply_markup: menuKeyboard(options) }); return; }
	for (const card of management) await renderAuthorManagement(ctx, options, userId, card);
	const managedIds = new Set(management.map((card) => card.collaborationId));
	const other = summaries.filter((summary) => !managedIds.has(summary.collaborationId));
	if (other.length > 0) {
		const lines = other.map((summary) => `• ${summary.title ?? "Без названия"} — ${collaborationStatusLabel(summary.status)}`);
		await ctx.reply(`Мои коллаборации\n\n${lines.join("\n")}`, { reply_markup: menuKeyboard(options) });
	}
}

async function renderOwnApplications(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const service = options.applicationService;
	if (service === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const applications = await service.listOwnApplications(userId);
	if (applications.length === 0) {
		await ctx.reply("У вас пока нет откликов.", { reply_markup: menuKeyboard(options) });
		return;
	}
	for (const application of applications) {
		const lines = [
			application.collaborationTitle ?? "Коллаборация",
			`Статус отклика: ${applicationStatusLabel(application.status)}`,
		];
		let keyboard: InlineKeyboard | undefined;
		if (application.status === "accepted") {
			const contact = await service.getPairContact(userId, application.applicationId);
			if (contact.ok) keyboard = new InlineKeyboard().url("Написать в Telegram", contact.url);
			else lines.push("Контакт сейчас недоступен.");
		}
		await ctx.reply(lines.join("\n"), { reply_markup: keyboard ?? menuKeyboard(options) });
	}
}

type AuthorManagementView = NonNullable<Awaited<ReturnType<ApplicationService["getAuthorManagement"]>>>;

async function renderAuthorManagement(
	ctx: Context,
	options: ProfileBotOptions,
	userId: string,
	management: AuthorManagementView,
): Promise<void> {
	const header = [
		"Управление коллаборацией",
		"",
		`${management.title ?? "Без названия"} — ${collaborationStatusLabel(management.status)}`,
		`Принято: ${management.acceptedCount} из ${management.slotsTotal}`,
		management.applications.length === 0 ? "Откликов пока нет." : `Откликов: ${management.applications.length}`,
	];
	let headerKeyboard: InlineKeyboard | undefined;
	if (management.status === "published" && management.acceptedCount > 0) {
		const closeToken = await createDecisionToken(options, userId, "collaboration.close", `collaboration:${management.collaborationId}`, management.projectionRevision);
		if (closeToken !== undefined) headerKeyboard = new InlineKeyboard().text("Завершить набор", closeToken);
	}
	await ctx.reply(header.join("\n"), { reply_markup: headerKeyboard ?? menuKeyboard(options) });
	for (const application of management.applications) {
		const applicant = application.applicant;
		const lines = [
			`Кандидат: ${applicant.displayName}`,
			`Тип: ${profileTypeLabel(applicant.type)}`,
			...(applicant.description === null ? [] : [`Описание: ${applicant.description}`]),
			...(applicant.topics.length === 0 ? [] : [`Темы: ${applicant.topics.map(topicLabel).join(", ")}`]),
			`Площадка: ${applicant.platform.title === null ? applicant.platform.url : `${applicant.platform.title} — ${applicant.platform.url}`}`,
			...(applicant.platform.audienceSize === null ? [] : [`Аудитория: ${applicant.platform.audienceSize}`]),
			"",
			`Сообщение: ${application.message}`,
			`Статус: ${applicationStatusLabel(application.status)}`,
		];
		let keyboard: InlineKeyboard | undefined;
		if (application.status === "pending") {
			const acceptToken = await createDecisionToken(options, userId, "application.accept", `application:${application.applicationId}`, management.projectionRevision);
			const rejectToken = await createDecisionToken(options, userId, "application.reject", `application:${application.applicationId}`, management.projectionRevision);
			if (acceptToken !== undefined && rejectToken !== undefined) keyboard = new InlineKeyboard().text("Принять", acceptToken).text("Отказать", rejectToken);
		} else if (application.status === "accepted") {
			const contact = await options.applicationService?.getPairContact(userId, application.applicationId);
			if (contact?.ok) keyboard = new InlineKeyboard().url("Написать в Telegram", contact.url);
			else lines.push("Контакт сейчас недоступен.");
		}
		await ctx.reply(lines.join("\n"), keyboard === undefined ? undefined : { reply_markup: keyboard });
	}
}

async function createDecisionToken(
	options: ProfileBotOptions,
	telegramUserId: string,
	actionType: "application.accept" | "application.reject" | "collaboration.close",
	entityId: string,
	expectedVersion: number,
): Promise<string | undefined> {
	if (options.callbackActionService === undefined) return undefined;
	return options.callbackActionService.create({
		actor: { kind: "telegram_user", telegramUserId },
		actionType,
		entityId,
		expectedVersion,
		mode: "one_shot",
		expiresAt: now(options.clock) + CALLBACK_ACTION_TTL_MS,
	});
}

function applicationStatusLabel(status: string): string {
	return ({ pending: "ожидает решения", accepted: "принят", rejected: "отклонён", closed: "закрыт", withdrawn: "отозван" } as Record<string, string>)[status] ?? "недоступен";
}

async function openFeed(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	if (options.collaborationBrowseService === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: menuKeyboard(options) });
		return;
	}
	try {
		await renderBrowsePage(ctx, options, await options.collaborationBrowseService.openFeed(userId));
	} catch (error) {
		if (error instanceof BrowseSessionStaleError) {
			await ctx.reply("Экран ленты устарел. Откройте ленту снова.", { reply_markup: new InlineKeyboard().text("Открыть ленту", "browse:start") });
			return;
		}
		throw error;
	}
}

async function handleBrowseMutation(ctx: Context, options: ProfileBotOptions, userId: string, mutation: BrowseMutation): Promise<void> {
	const service = options.collaborationBrowseService;
	if (service === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: menuKeyboard(options) });
		return;
	}
	try {
		switch (mutation.kind) {
			case "next":
				await renderBrowsePage(ctx, options, await service.next(userId, mutation));
				return;
			case "reset":
				await renderBrowsePage(ctx, options, await service.reset(userId, mutation));
				return;
			case "filters": {
				const session = await service.touch(userId, mutation);
				await renderBrowseFilterDimensions(ctx, session);
				return;
			}
			case "filter": {
				if (mutation.dimension === undefined) throw new BrowseSessionStaleError();
				const session = await service.touch(userId, mutation);
				await renderBrowseFilterValues(ctx, session, mutation.dimension);
				return;
			}
			case "set": {
				const dimension = toBrowseFilterDimension(mutation.dimension);
				if (dimension === undefined || mutation.value === undefined) throw new BrowseSessionStaleError();
				const value: BrowseFilterValue = mutation.value === "any" ? null : mutation.value as BrowseFilterValue;
				await renderBrowsePage(ctx, options, await service.changeFilter(userId, mutation, dimension, value));
				return;
			}
		}
	} catch (error) {
		if (error instanceof BrowseSessionStaleError || error instanceof DomainValidationError) {
			await ctx.reply("Экран ленты устарел. Откройте ленту снова.", { reply_markup: new InlineKeyboard().text("Открыть ленту", "browse:start") });
			return;
		}
		throw error;
	}
}

async function renderBrowsePage(ctx: Context, options: ProfileBotOptions, page: BrowsePage): Promise<void> {
	const current = options.collaborationBrowseService === undefined ? page : await options.collaborationBrowseService.revalidate(page);
	if (current.card === null) {
		await ctx.reply("Подходящих карточек пока нет. Измените фильтры или покажите выдачу сначала.", { reply_markup: browseEmptyKeyboard(current.session) });
		return;
	}
	await ctx.reply(renderCollaborationCard(current.card), { parse_mode: "HTML", reply_markup: browseCardKeyboard(current.card, current.session) });
}

async function renderDeepLink(ctx: Context, options: ProfileBotOptions, userId: string, startParameter: string): Promise<void> {
	if (/^c_[A-Za-z0-9_-]{22}$/.test(startParameter) && options.applicationService !== undefined) {
		const management = await options.applicationService.getAuthorManagementByPublicToken(userId, startParameter.slice(2));
		if (management !== undefined) {
			await renderAuthorManagement(ctx, options, userId, management);
			return;
		}
	}
	const service = options.collaborationBrowseService;
	if (service === undefined) {
		await ctx.reply("Предложение недоступно.", { reply_markup: menuKeyboard(options) });
		return;
	}
	await renderDeepLinkResult(ctx, options, await service.openDeepLink(userId, startParameter));
}

async function renderDeepLinkResult(ctx: Context, options: ProfileBotOptions, result: Awaited<ReturnType<CollaborationBrowseService["openDeepLink"]>>): Promise<void> {
	switch (result.kind) {
		case "card":
			await ctx.reply(renderCollaborationCard(result.card), { parse_mode: "HTML", reply_markup: deepLinkCardKeyboard(result.card, result.actionable) });
			return;
		case "expired":
			await ctx.reply("Срок откликов истёк.", { reply_markup: menuKeyboard(options) });
			return;
		case "closed":
			await ctx.reply("Предложение закрыто.", { reply_markup: menuKeyboard(options) });
			return;
		case "unavailable":
			await ctx.reply("Предложение недоступно.", { reply_markup: menuKeyboard(options) });
			return;
	}
}

async function handleApplicationStart(ctx: Context, options: ProfileBotOptions, userId: string, start: ApplicationStart): Promise<void> {
	const browseService = options.collaborationBrowseService;
	const applicationService = options.applicationService;
	if (browseService === undefined || applicationService === undefined) {
		await ctx.reply("Отклик сейчас недоступен.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const currentSession = await activeSession(options, userId);
	if (currentSession !== undefined) {
		await ctx.reply("Сначала завершите или отмените текущее заполнение.", { reply_markup: resumeKeyboard(currentSession) });
		return;
	}
	const result = await browseService.openDeepLink(userId, `c_${start.publicToken}`);
	if (result.kind !== "card") {
		await renderDeepLinkResult(ctx, options, result);
		return;
	}
	const eligibility = await applicationService.checkEligibility({
		telegramUserId: userId,
		collaborationId: result.card.id,
		occurredAt: telegramOccurredAt(ctx.update).getTime(),
	});
	const continuation: ApplicationContinuation = {
		kind: "submit_application",
		collaborationId: result.card.id,
		source: start.source,
	};
	if (eligibility.ok) {
		const saved = await saveState(options, userId, {
			version: PROFILE_SESSION_VERSION,
			generation: createSessionGeneration(),
			step: "application_message",
			draft: {},
			continuation,
		});
		await renderStep(ctx, options, userId, saved);
		return;
	}
	if (eligibility.code === "profile_required") {
		const saved = await saveState(options, userId, {
			version: PROFILE_SESSION_VERSION,
			generation: createSessionGeneration(),
			step: "type",
			draft: { description: null, topics: [] },
			continuation,
		});
		await ctx.reply("Чтобы откликнуться, создадим короткий профиль — это займёт около минуты.");
		await renderStep(ctx, options, userId, saved);
		return;
	}
	await replyApplicationFailure(ctx, options, eligibility.code);
}

async function finishQuickApplicationProfile(
	ctx: Context,
	options: ProfileBotOptions,
	userId: string,
	state: ApplicationProfileState,
): Promise<void> {
	const input = toProfileInput(state.draft);
	if (input === undefined) {
		const current = await activeSession(options, userId);
		await ctx.reply("Не все обязательные данные профиля заполнены.", current === undefined ? undefined : { reply_markup: resumeKeyboard(current) });
		return;
	}
	try {
		if (await options.profileService.getOwn(userId) === undefined) await options.profileService.create(userId, input);
	} catch (error) {
		if (error instanceof Error && (error.name === "DomainValidationError" || error.name === "ProfileAlreadyExistsError")) {
			await ctx.reply("Не удалось сохранить короткий профиль. Проверьте данные и попробуйте ещё раз.");
			return;
		}
		throw error;
	}
	const applicationService = options.applicationService;
	if (applicationService === undefined) {
		await options.sessionRepository.delete(userId);
		await ctx.reply("Профиль сохранён, но отклик сейчас недоступен.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const eligibility = await applicationService.checkEligibility({
		telegramUserId: userId,
		collaborationId: state.continuation.collaborationId,
		occurredAt: telegramOccurredAt(ctx.update).getTime(),
	});
	if (!eligibility.ok) {
		await options.sessionRepository.delete(userId);
		await replyApplicationFailure(ctx, options, eligibility.code, undefined, true);
		return;
	}
	const saved = await saveState(options, userId, {
		...state,
		step: "application_message",
		draft: state.draft,
	});
	await ctx.reply("Профиль сохранён. Теперь добавьте сообщение автору коллаборации.");
	await renderStep(ctx, options, userId, saved);
}

async function submitApplicationMessage(
	ctx: Context,
	options: ProfileBotOptions,
	userId: string,
	session: ApplicationProfileSession,
	message: string,
): Promise<void> {
	const applicationService = options.applicationService;
	if (applicationService === undefined) {
		await ctx.reply("Отклик сейчас недоступен.", { reply_markup: applicationNavigationKeyboard(session) });
		return;
	}
	const result = await applicationService.submit({
		telegramUserId: userId,
		collaborationId: session.state.continuation.collaborationId,
		message,
		occurredAt: telegramOccurredAt(ctx.update).getTime(),
	});
	if (result.ok) {
		await options.sessionRepository.delete(userId);
		await ctx.reply("Отклик отправлен автору коллаборации.", { reply_markup: menuKeyboard(options) });
		return;
	}
	if (result.code !== "invalid_message") await options.sessionRepository.delete(userId);
	await replyApplicationFailure(ctx, options, result.code, result.code === "invalid_message" ? session : undefined);
}

async function reopenApplicationCard(ctx: Context, options: ProfileBotOptions, userId: string, collaborationId: string): Promise<void> {
	const applicationService = options.applicationService;
	const browseService = options.collaborationBrowseService;
	if (applicationService === undefined || browseService === undefined) {
		await ctx.reply("Предложение недоступно.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const eligibility = await applicationService.checkEligibility({
		telegramUserId: userId,
		collaborationId,
		occurredAt: telegramOccurredAt(ctx.update).getTime(),
	});
	if (!eligibility.ok) {
		await replyApplicationFailure(ctx, options, eligibility.code);
		return;
	}
	const publicToken = eligibility.target.publicToken;
	if (publicToken === null) {
		await ctx.reply("Предложение недоступно.", { reply_markup: menuKeyboard(options) });
		return;
	}
	await renderDeepLinkResult(ctx, options, await browseService.openDeepLink(userId, `c_${publicToken}`));
}

async function replyApplicationFailure(
	ctx: Context,
	options: ProfileBotOptions,
	code: ApplicationFailureCode,
	session?: SessionIdentity,
	profileWasSaved = false,
): Promise<void> {
	if (code === "invalid_message") {
		await ctx.reply("Сообщение должно содержать от 10 до 500 символов.", {
			reply_markup: session === undefined ? menuKeyboard(options) : applicationNavigationKeyboard(session),
		});
		return;
	}
	const text: Record<Exclude<ApplicationFailureCode, "invalid_message">, string> = {
		actor_inactive: "Отклик сейчас недоступен.",
		profile_required: "Для отклика нужен активный профиль.",
		target_unavailable: "Предложение больше недоступно для отклика.",
		own_collaboration: "Нельзя откликнуться на собственную коллаборацию.",
		profile_type_mismatch: "Ваш тип профиля не подходит для этой коллаборации.",
		deadline_passed: "Срок приёма откликов уже истёк.",
		duplicate: "Вы уже откликались на эту коллаборацию.",
		full: "Все места в этой коллаборации уже заняты.",
	};
	await ctx.reply(`${profileWasSaved ? "Профиль сохранён. " : ""}${text[code]}`, { reply_markup: menuKeyboard(options) });
}

async function renderBrowseFilterDimensions(ctx: Context, session: BrowseSessionRecord): Promise<void> {
	const target = session.filters.targetProfileType === null ? "Любой" : PROFILE_TYPE_LABELS[session.filters.targetProfileType];
	const format = session.filters.format === null ? "Любой" : COLLABORATION_FORMAT_LABELS[session.filters.format];
	const topic = session.filters.topic === null ? "Любая" : TOPIC_LABELS[session.filters.topic];
	const keyboard = new InlineKeyboard()
		.text(`Тип: ${target}`, browseCallback("b:f:t", session)).row()
		.text(`Формат: ${format}`, browseCallback("b:f:f", session)).row()
		.text(`Тема: ${topic}`, browseCallback("b:f:o", session)).row()
		.text("Показать сначала", browseCallback("b:r", session));
	await ctx.reply("Настройте фильтры. Выбранные измерения применяются вместе.", { reply_markup: keyboard });
}

async function renderBrowseFilterValues(ctx: Context, session: BrowseSessionRecord, dimension: NonNullable<BrowseMutation["dimension"]>): Promise<void> {
	const keyboard = new InlineKeyboard();
	if (dimension === "target") {
		for (const [value, label] of [["any", "Любой"], ["blogger", "Блогер"], ["telegram_channel", "Telegram-канал"], ["venue_or_brand", "Заведение или бренд"]] as const) keyboard.text(label, browseCallback(`b:s:t:${value}`, session)).row();
	} else if (dimension === "format") {
		keyboard.text("Любой", browseCallback("b:s:f:any", session)).row();
		for (const [value, label] of Object.entries(COLLABORATION_FORMAT_LABELS) as [CollaborationFormat, string][]) keyboard.text(label, browseCallback(`b:s:f:${value}`, session)).row();
	} else {
		keyboard.text("Любая", browseCallback("b:s:o:any", session)).row();
		for (const [value, label] of Object.entries(TOPIC_LABELS) as [Topic, string][]) keyboard.text(label, browseCallback(`b:s:o:${value}`, session)).row();
	}
	await ctx.reply("Выберите значение фильтра:", { reply_markup: keyboard });
}

function collaborationStatusLabel(status: import("../domain/value-objects/enums.js").CollaborationStatus): string {
	return ({ draft: "черновик", publishing: "публикация запущена", published: "опубликована", publication_failed: "ошибка публикации", expired: "истекла", matched: "совпадение", completed: "завершена", cancelled: "отменена", hidden: "скрыта" } as Record<string, string>)[status] ?? status;
}

async function renderStep(ctx: Context, options: ProfileBotOptions, userId: string, session: ProfileSessionRecord): Promise<void> {
	const state = session.state;
	switch (state.step) {
		case "type": await ctx.reply("Выберите, кто вы:", { reply_markup: typeKeyboard(session) }); return;
		case "display_name": await ctx.reply("Как назвать ваш профиль? Это может быть ваше имя, название канала, заведения или бренда (2–100 символов).", { reply_markup: cancelKeyboard(session) }); return;
		case "topics": await ctx.reply("Укажите до 3 тем через запятую: Lifestyle, Еда и рестораны, Красота, Путешествия, Город, События, Семья, Спорт, Бизнес, Другое. Поле можно пропустить.", { reply_markup: optionalKeyboard(session, hasTopics(state.draft)) }); return;
		case "description": await ctx.reply("Опишите профиль (10–500 символов) или пропустите поле.", { reply_markup: optionalKeyboard(session, state.draft.description !== undefined && state.draft.description !== null) }); return;
		case "platform": await ctx.reply(PROFILE_LINK_PROMPT, { reply_markup: platformKeyboard(session, ctx.from?.username) }); return;
		case "platform_url": await ctx.reply("Укажите другую публичную ссылку https://...", { reply_markup: cancelKeyboard(session) }); return;
		case "audience": await ctx.reply("Укажите размер аудитории числом или пропустите поле.", { reply_markup: optionalKeyboard(session, state.draft.platform?.audienceSize !== undefined) }); return;
		case "review": await renderReview(ctx, options, userId); return;
		case "application_message": await ctx.reply("Напишите сообщение автору: почему вам интересна коллаборация и что вы можете предложить (10–500 символов).", { reply_markup: applicationNavigationKeyboard(session) }); return;
	}
}

async function renderReview(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	if (session === undefined) return;
	const draft = session.state.draft;
	const lines = [
		"Проверьте профиль",
		"",
		`Название: ${draft.displayName ?? "—"}`,
		`Кто вы: ${draft.type === undefined ? "—" : profileTypeLabel(draft.type)}`,
		...(draft.description === undefined || draft.description === null ? [] : [`Описание: ${draft.description}`]),
		...(draft.topics === undefined || draft.topics.length === 0 ? [] : [`Темы: ${draft.topics.map(topicLabel).join(", ")}`]),
		`Площадка: ${draft.platform?.url ?? "—"}`,
		...(draft.platform?.audienceSize === undefined ? [] : [`Аудитория: ${draft.platform.audienceSize}`]),
	];
	await ctx.reply(lines.join("\n"), { reply_markup: reviewKeyboard(session) });
}

async function ensureActor(ctx: Context, options: ProfileBotOptions): Promise<boolean> {
	if (ctx.from === undefined) return false;
	const id = String(ctx.from.id);
	await upsertActorSnapshot(ctx, options);
	const record = await options.telegramUserRepository.findByTelegramUserId(id);
	return record?.status === "active";
}

async function upsertActorSnapshot(ctx: Context, options: ProfileBotOptions): Promise<void> {
	if (ctx.from === undefined) return;
	const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim() || "Telegram user";
	await options.telegramUserRepository.upsert({
		telegramUserId: String(ctx.from.id),
		...(ctx.from.username === undefined ? {} : { username: ctx.from.username }),
		displayName,
		updatedAt: now(options.clock),
	});
}

async function activeSession(options: ProfileBotOptions, userId: string) {
	return options.sessionRepository.findActive(userId, now(options.clock));
}

async function sessionAtRevision(ctx: Context, options: ProfileBotOptions, userId: string, expected: SessionToken) {
	const session = await activeSession(options, userId);
	if (session === undefined || session.revision !== expected.revision || session.state.generation !== expected.generation) {
		await ctx.reply("Эта кнопка уже неактуальна. Откройте «👤 Мой профиль» и продолжите с текущего шага.");
		return undefined;
	}
	return session;
}

async function saveState(options: ProfileBotOptions, userId: string, state: ProfileSessionState) {
	const current = await options.sessionRepository.findActive(userId, now(options.clock));
	const record = {
		telegramUserId: userId,
		state,
		revision: (current?.revision ?? 0) + 1,
		expiresAt: now(options.clock) + PROFILE_SESSION_TTL_MS,
		updatedAt: now(options.clock),
	} as const;
	await options.sessionRepository.save(record);
	return record;
}

function toProfileInput(draft: ProfileDraft): ProfileInput | undefined {
	if (draft.type === undefined || draft.displayName === undefined || draft.description === undefined || draft.topics === undefined || draft.platform === undefined) return undefined;
	return { type: draft.type, displayName: draft.displayName, description: draft.description, topics: draft.topics, platforms: [draft.platform] };
}

function parseTopics(value: string): Topic[] | undefined {
	const values = value.split(",").map((topic) => topic.trim()).filter(Boolean);
	if (values.length < 1 || values.length > 3) return undefined;
	try {
		const topics = values.map((topic) => TOPIC_INPUTS.get(topic.toLowerCase()) ?? parseTopic(topic.toLowerCase()));
		return new Set(topics).size === topics.length ? topics : undefined;
	} catch { return undefined; }
}

function profileTypeLabel(type: ProfileType): string { return PROFILE_TYPE_LABELS[type]; }
function topicLabel(topic: Topic): string { return TOPIC_LABELS[topic]; }

function isAbsoluteHttps(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && url.username === "" && url.password === ""; } catch { return false; } }
function isTelegramHost(value: string): boolean { try { return new URL(value).hostname.toLowerCase() === "t.me"; } catch { return false; } }
function telegramUsernameFromUrl(value: string): string | undefined { if (!isAbsoluteHttps(value)) return undefined; try { const url = new URL(value); if (url.hostname.toLowerCase() !== "t.me") return undefined; return normalizeTelegramUsername(url.pathname.slice(1).replace(/\/$/, "")); } catch { return undefined; } }
function normalizeTelegramUsername(value: string): string | undefined { const normalized = value.trim().replace(/^@+/, ""); return /^[A-Za-z0-9_]{5,32}$/.test(normalized) ? normalized : undefined; }
function uniqueRequestId(candidate: number, previous: number | undefined): number { return Number.isSafeInteger(candidate) && candidate >= -2_147_483_648 && candidate <= 2_147_483_647 && candidate !== previous ? candidate : (previous === 2_147_483_647 ? 1 : 2_147_483_647); }
function now(clock: Clock): number { return clock.now().getTime(); }
function getUpdateId(update: Update): number | undefined { return Number.isSafeInteger(update.update_id) && update.update_id >= 0 ? update.update_id : undefined; }
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
function parseProfileMutationCallback(data: string): ProfileMutationCallback | undefined {
	const match = /^(profile:(?:back|cancel|apply|omit)|profile:(?:type|platform):([a-z_]+)):g([a-f0-9]{16}):r(\d+)$/.exec(data);
	if (match === null) return undefined;
	const [, action, value, generation, revisionRaw] = match;
	if (action === undefined || generation === undefined || revisionRaw === undefined) return undefined;
	const revision = Number(revisionRaw);
	if (!Number.isSafeInteger(revision) || revision < 0) return undefined;
	if (action === "profile:back") return { kind: "back", generation, revision };
	if (action === "profile:cancel") return { kind: "cancel", generation, revision };
	if (action === "profile:apply") return { kind: "apply", generation, revision };
	if (action === "profile:omit") return { kind: "omit", generation, revision };
	if (action.startsWith("profile:type:")) return { kind: "type", value: value ?? action.slice("profile:type:".length), generation, revision };
	if (action.startsWith("profile:platform:")) return { kind: "platform", value: value ?? action.slice("profile:platform:".length), generation, revision };
	return undefined;
}

function parseBrowseMutation(data: string): BrowseMutation | undefined {
	let match = /^b:(n|r|fs):([0-9a-f]{16}):([0-9a-z]+)$/.exec(data);
	if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
		const revision = parseBase36Revision(match[3]);
		const kind = ({ n: "next", r: "reset", fs: "filters" } as const)[match[1] as "n" | "r" | "fs"];
		return revision === undefined ? undefined : { kind, generation: match[2], revision };
	}
	match = /^b:f:(t|f|o):([0-9a-f]{16}):([0-9a-z]+)$/.exec(data);
	if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
		const revision = parseBase36Revision(match[3]);
		const dimension = parseBrowseDimensionCode(match[1]);
		return revision === undefined || dimension === undefined ? undefined : { kind: "filter", dimension, generation: match[2], revision };
	}
	match = /^b:s:(t|f|o):([a-z_]+):([0-9a-f]{16}):([0-9a-z]+)$/.exec(data);
	if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined && match[4] !== undefined) {
		const revision = parseBase36Revision(match[4]);
		const dimension = parseBrowseDimensionCode(match[1]);
		return revision === undefined || dimension === undefined ? undefined : { kind: "set", dimension, value: match[2], generation: match[3], revision };
	}
	return undefined;
}

function parseApplicationStart(data: string): ApplicationStart | undefined {
	const match = /^application:start:(f|d):([A-Za-z0-9_-]{22})$/.exec(data);
	if (match?.[1] === undefined || match[2] === undefined) return undefined;
	return { publicToken: match[2], source: match[1] === "f" ? "feed" : "deep_link" };
}

function parseBase36Revision(value: string): number | undefined {
	const revision = Number.parseInt(value, 36);
	return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
}

function parseBrowseDimensionCode(value: string): NonNullable<BrowseMutation["dimension"]> | undefined {
	if (value === "t") return "target";
	if (value === "f") return "format";
	if (value === "o") return "topic";
	return undefined;
}

function toBrowseFilterDimension(value: BrowseMutation["dimension"]): BrowseFilterDimension | undefined {
	if (value === "target") return "target_profile_type";
	if (value === "format" || value === "topic") return value;
	return undefined;
}
function withoutRequestId<T extends ProfileSessionState>(state: T): Omit<T, "requestId"> {
	const without: { -readonly [Key in keyof T]: T[Key] } = { ...state };
	delete without.requestId;
	return without;
}
function isApplicationState(state: ProfileSessionState): state is ApplicationProfileState {
	return state.continuation?.kind === "submit_application";
}
function isApplicationSession(session: ProfileSessionRecord | undefined): session is ApplicationProfileSession {
	return session !== undefined && isApplicationState(session.state);
}
function sessionToken(session: ProfileSessionRecord): SessionToken {
	return { generation: session.state.generation, revision: session.revision };
}
function withoutPlatform(draft: ProfileDraft): ProfileDraft {
	const without = { ...draft };
	delete without.platform;
	return without;
}

function withoutAudience(platform: ProfileInput["platforms"][number]): ProfileInput["platforms"][number] {
	const without = { ...platform };
	delete without.audienceSize;
	return without;
}

function hasTopics(draft: ProfileDraft): boolean {
	return draft.topics !== undefined && draft.topics.length > 0;
}

function parseCollaborationMutationCallback(data: string): CollaborationMutation | undefined {
	const match = /^collaboration:(format|target|back|cancel|preview|publish)(?::([a-z_]+))?:g([a-f0-9]{16}):r(\d+)$/.exec(data);
	if (match === null || match[1] === undefined || match[3] === undefined || match[4] === undefined) return undefined;
	const revision = Number(match[4]);
	if (!Number.isSafeInteger(revision) || revision < 0) return undefined;
	return { kind: match[1] as CollaborationMutationKind, ...(match[2] === undefined ? {} : { value: match[2] }), generation: match[3], revision };
}

function collaborationCallbackInput(mutation: CollaborationMutation): { readonly input: CollaborationDraftInput; readonly step: CollaborationWizardStep } | undefined {
	if (mutation.kind === "format" && mutation.value !== undefined) {
		const value = mutation.value === "ad" ? "advertising_integration" : mutation.value;
		try { return { input: { format: parseCollaborationFormat(value) }, step: "target_profile_type" }; } catch { return undefined; }
	}
	if (mutation.kind === "target" && mutation.value !== undefined) {
		try { return { input: { targetProfileType: parseTargetProfileType(mutation.value) }, step: "topics" }; } catch { return undefined; }
	}
	return undefined;
}

function parseCollaborationTopics(value: string): Topic[] | undefined {
	const values = value.split(",").map((topic) => topic.trim().toLowerCase()).filter(Boolean);
	if (values.length < 1 || values.length > 3) return undefined;
	const aliases = new Map<string, Topic>([
		["лайфстайл", "lifestyle"], ["еда", "food"], ["еда и рестораны", "food"], ["красота", "beauty"], ["путешествия", "travel"],
		["город", "city"], ["события", "events"], ["семья", "family"], ["спорт", "sport"], ["бизнес", "business"], ["другое", "other"],
	]);
	try {
		const topics = values.map((topic) => aliases.get(topic) ?? parseTopic(topic));
		return new Set(topics).size === topics.length ? topics : undefined;
	} catch { return undefined; }
}

function previousCollaborationStep(step: CollaborationWizardStep): CollaborationWizardStep | undefined {
	const order: readonly CollaborationWizardStep[] = ["format", "target_profile_type", "topics", "title", "offer", "expectation", "slots", "deadline", "event_date", "preview"];
	const index = order.indexOf(step);
	return index <= 0 ? undefined : order[index - 1];
}

function collaborationCallback(action: string, state: CollaborationDraftState, revision: number): string {
	return `${action}:g${state.generation}:r${revision}`;
}

function collaborationKeyboard(state: CollaborationDraftState, revision: number, options?: ProfileBotOptions): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (state.step === "format") {
		for (const [value, label] of [["advertising_integration", "Рекламная интеграция"], ["barter", "Бартер"], ["joint_giveaway", "Совместный розыгрыш"], ["joint_content", "Совместный контент"], ["mutual_pr", "Взаимопиар"], ["event", "Мероприятие"], ["other", "Другое"]] as const) {
			const callbackValue = value === "advertising_integration" ? "ad" : value;
			keyboard.text(label, collaborationCallback(`collaboration:format:${callbackValue}`, state, revision)).row();
		}
		keyboard.text("← В главное меню", collaborationCallback("collaboration:back", state, revision)).row();
	} else if (state.step === "target_profile_type") {
		for (const [value, label] of [["blogger", "Блогер"], ["telegram_channel", "Telegram-канал"], ["venue_or_brand", "Заведение или бренд"], ["any", "Любой партнёр"]] as const) keyboard.text(label, collaborationCallback(`collaboration:target:${value}`, state, revision)).row();
	} else if (state.step === "preview") {
		if (options?.collaborationPublicationService !== undefined) keyboard.text("📣 Опубликовать", collaborationCallback("collaboration:publish", state, revision)).row();
		keyboard.text("← Назад", collaborationCallback("collaboration:back", state, revision)).row();
		keyboard.text("Отменить черновик", collaborationCallback("collaboration:cancel", state, revision));
		return keyboard;
	} else {
		keyboard.text("← Назад", collaborationCallback("collaboration:back", state, revision)).row();
	}
	keyboard.text("Отменить черновик", collaborationCallback("collaboration:cancel", state, revision));
	return keyboard;
}

function menuKeyboard(options?: ProfileBotOptions): InlineKeyboard {
	const collaborationAction = options?.collaborationDraftService === undefined ? "profile:unavailable" : "collaboration:start";
	const browseAction = options?.collaborationBrowseService === undefined ? "profile:unavailable" : "browse:start";
	return new InlineKeyboard().text("➕ Создать коллаборацию", collaborationAction).row().text("🔎 Найти коллаборацию", browseAction).row().text("📋 Мои коллаборации", options?.collaborationPublicationService === undefined ? "profile:unavailable" : "collaboration:own").row().text("💬 Мои отклики", options?.applicationService === undefined ? "profile:unavailable" : "application:own").row().text("👤 Мой профиль", "profile:view");
}
function browseCallback(action: string, session: BrowseSessionRecord): string { return `${action}:${session.generation}:${session.revision.toString(36)}`; }
function browseCardKeyboard(card: BrowseCollaborationRecord, session: BrowseSessionRecord): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (card.publicToken !== null) keyboard.text("Откликнуться", `application:start:f:${card.publicToken}`).row();
	return keyboard
		.text("Дальше", browseCallback("b:n", session)).row()
		.text("Фильтры", browseCallback("b:fs", session)).row()
		.text("Показать сначала", browseCallback("b:r", session));
}
function browseEmptyKeyboard(session: BrowseSessionRecord): InlineKeyboard {
	return new InlineKeyboard()
		.text("Фильтры", browseCallback("b:fs", session)).row()
		.text("Показать сначала", browseCallback("b:r", session)).row()
		.text("← В главное меню", "menu:home");
}
function deepLinkCardKeyboard(card: BrowseCollaborationRecord, actionable: boolean): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (actionable && card.publicToken !== null) keyboard.text("Откликнуться", `application:start:d:${card.publicToken}`).row();
	return keyboard.text("Открыть ленту", "browse:start").row().text("← В главное меню", "menu:home");
}
function createSessionGeneration(): string { return randomBytes(8).toString("hex"); }
function revisionCallback(action: string, identity: SessionIdentity): string {
	const normalized = "state" in identity ? { generation: identity.state.generation, revision: identity.revision } : identity;
	return `${action}:g${normalized.generation}:r${normalized.revision}`;
}
function resumeKeyboard(identity: SessionIdentity): InlineKeyboard {
	const application = "state" in identity && isApplicationState(identity.state);
	return new InlineKeyboard()
		.text(application ? "▶️ Продолжить отклик" : "▶️ Продолжить профиль", "profile:resume").row()
		.text(application ? "Отменить отклик" : "Отменить заполнение", revisionCallback("profile:cancel", identity));
}
function reviewKeyboard(identity: SessionIdentity): InlineKeyboard { return new InlineKeyboard().text("Сохранить профиль", revisionCallback("profile:apply", identity)).row().text("Отменить заполнение", revisionCallback("profile:cancel", identity)); }
function cancelKeyboard(identity: SessionIdentity): InlineKeyboard {
	return "state" in identity && isApplicationState(identity.state)
		? applicationNavigationKeyboard(identity)
		: new InlineKeyboard().text("Отменить заполнение", revisionCallback("profile:cancel", identity));
}
function optionalKeyboard(identity: SessionIdentity, populated: boolean): InlineKeyboard { return new InlineKeyboard().text(populated ? "Очистить" : "Пропустить", revisionCallback("profile:omit", identity)).row().text("Отменить заполнение", revisionCallback("profile:cancel", identity)); }
function typeKeyboard(identity: SessionIdentity): InlineKeyboard {
	const keyboard = new InlineKeyboard().text("Блогер", revisionCallback("profile:type:blogger", identity)).row().text("Telegram-канал", revisionCallback("profile:type:telegram_channel", identity)).row().text("Заведение или бренд", revisionCallback("profile:type:venue_or_brand", identity));
	if ("state" in identity && isApplicationState(identity.state)) keyboard.row().text("← Назад", revisionCallback("profile:back", identity)).row().text("Отменить", revisionCallback("profile:cancel", identity));
	return keyboard;
}
function platformKeyboard(identity: SessionIdentity, currentUsername?: string): InlineKeyboard {
	const username = currentUsername === undefined ? undefined : normalizeTelegramUsername(currentUsername);
	const keyboard = new InlineKeyboard();
	if (username !== undefined) keyboard.text(`Использовать @${username}`, revisionCallback("profile:platform:self", identity)).row();
	keyboard.text("Выбрать Telegram-канал", revisionCallback("profile:platform:telegram", identity)).row().text("Указать другую ссылку", revisionCallback("profile:platform:other", identity));
	if ("state" in identity && isApplicationState(identity.state)) keyboard.row().text("← Назад", revisionCallback("profile:back", identity)).row().text("Отменить", revisionCallback("profile:cancel", identity));
	return keyboard;
}
function applicationNavigationKeyboard(identity: SessionIdentity): InlineKeyboard {
	return new InlineKeyboard()
		.text("← Назад", revisionCallback("profile:back", identity)).row()
		.text("Отменить", revisionCallback("profile:cancel", identity));
}
