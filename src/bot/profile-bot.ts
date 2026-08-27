import { Bot, Composer, InlineKeyboard, type Context } from "grammy";
import type { Update } from "grammy/types";

import type { Clock } from "../application/ports/clock.js";
import type { CanonicalInput } from "../application/commands/canonical-input.js";
import type { DurableCommandExecutor } from "../application/commands/command-executor.js";
import type { CallbackActionService } from "../application/commands/callback-action.js";
import type { SafeResult } from "../application/commands/safe-result.js";
import type {
	ProfileSessionRepository,
	ProfileDraft,
} from "../application/ports/profile-session-repository.js";
import type { TelegramUserWriter } from "../application/ports/telegram-user-writer.js";
import { ProfileService } from "../application/profiles/profile-service.js";
import { ProfileAudienceService, type ProfileAudiencePlan } from "../application/profiles/profile-audience-service.js";
import type { CollaborationDraftService } from "../application/collaborations/collaboration-draft-service.js";
import { renderCollaborationCard } from "../application/collaborations/collaboration-renderer.js";
import type { CollaborationPublicationService } from "../application/collaborations/collaboration-publication-service.js";
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
import type { AdminModerationService } from "../application/moderation/admin-moderation-service.js";
import type { ProfileRecord } from "../domain/profiles/profile.js";
import { DomainValidationError, type CollaborationFormat, type Topic } from "../domain/value-objects/enums.js";
import { createCollaborationTelegramFeature, type CollaborationTelegramFeature } from "./collaboration/collaboration-composer.js";
import { COLLABORATION_FORMAT_LABELS, collaborationStatusLabel } from "./collaboration/collaboration-presentation.js";
import { registerDurableTelegramIngress } from "./durable-telegram-ingress.js";
import { createProfileTelegramFeature, type ProfileTelegramFeature } from "./profile/profile-composer.js";
import {
	PROFILE_TYPE_LABELS,
	TOPIC_LABELS,
	applicationNavigationKeyboard,
	profileTypeLabel,
	resumeKeyboard,
	topicLabel,
	type ApplicationContinuation,
	type ProfileSessionIdentity,
} from "./profile/profile-presentation.js";

const ROOT_STATIC_CALLBACKS = new Set(["menu:home", "profile:unavailable", "application:own", "browse:start"]);
const CALLBACK_ACTION_TTL_MS = 24 * 60 * 60 * 1_000;
const AUDIENCE_SNAPSHOT_UNAVAILABLE = "Аудиторию Telegram определить не удалось; профиль сохранён, число можно указать позже в «Мой профиль».";
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
export interface ProfileBotOptions {
	readonly profileService: ProfileService;
	readonly profileAudienceService?: ProfileAudienceService;
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
	readonly adminModerationService?: AdminModerationService;
}

export interface RegisteredProfileBot {
	readonly profileService: ProfileService;
}

export function registerProfileBot(bot: Bot, options: ProfileBotOptions): RegisteredProfileBot {
	const collaborationFeature = createCollaborationTelegramFeature({
		...(options.collaborationDraftService === undefined ? {} : { draftService: options.collaborationDraftService }),
		...(options.collaborationPublicationService === undefined ? {} : { publicationService: options.collaborationPublicationService }),
		menuKeyboard: () => menuKeyboard(options),
		profileFlow: {
			findSession: (userId) => profileFeature.findSession(userId),
			hasOwnProfile: async (userId) => await options.profileService.getOwn(userId) !== undefined,
			startForCollaboration: (ctx, userId) => profileFeature.startOrResume(ctx, userId, false, { kind: "create_collaboration" }),
			resumeKeyboard,
		},
		renderManagedCollaborations: (ctx, userId) => renderManagedCollaborations(ctx, options, userId),
	});
	const profileFeature = createProfileTelegramFeature({
		profileService: options.profileService,
		sessionRepository: options.sessionRepository,
		clock: options.clock,
		...(options.requestIdFactory === undefined ? {} : { requestIdFactory: options.requestIdFactory }),
		...(options.applicationService === undefined ? {} : { applicationService: options.applicationService }),
		menuKeyboard: () => menuKeyboard(options),
		isCollaborationActive: (userId) => collaborationFeature.isActive(userId),
		continueCreateCollaboration: (ctx, userId) => collaborationFeature.continueAfterProfile(ctx, userId),
		scheduleProfileAudience: (ctx, profile, draft) => scheduleProfileAudience(ctx, options, profile, draft),
		reopenApplicationCard: (ctx, userId, collaborationId) => reopenApplicationCard(ctx, options, userId, collaborationId),
		replyApplicationFailure: (ctx, code, session, profileWasSaved) => replyApplicationFailure(ctx, options, code, session, profileWasSaved),
		occurredAt: (ctx) => telegramOccurredAt(ctx.update).getTime(),
	});

	const messageRoute = new Composer<Context>();
	messageRoute.on("message", async (workCtx, next) => {
		if (workCtx.chat?.type !== "private" || workCtx.from === undefined) return;
		if (!(await ensureActor(workCtx, options))) return;
		await next();
	});
	messageRoute.on("message:text", async (workCtx, next) => {
		const userId = String(workCtx.from.id);
		const text = workCtx.message.text;
		const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
		if (command === "/admin") {
			if (options.adminModerationService?.isAdminTelegramUserId(userId) !== true) {
				await replyUnknownCommand(workCtx, options);
				return;
			}
			await handleAdminCommand(workCtx, options, userId, text);
			return;
		}
		if (command === "/start") {
			const startParameter = text.trim().slice(command.length).trim();
			if (startParameter.startsWith("c_")) {
				await renderDeepLink(workCtx, options, userId, startParameter);
				return;
			}
			await renderMenu(workCtx, options, profileFeature, collaborationFeature, userId);
			return;
		}
		if (command === "/help") {
			await workCtx.reply(`«Давай вместе» помогает блогерам, Telegram-каналам, заведениям и брендам находить партнёров для совместных проектов.\n\nСейчас сервис работает в Екатеринбурге. Вы можете создать и отредактировать свой профиль. По вопросам работы бота: ${options.helpContact}`);
			return;
		}
		if (await collaborationFeature.routeCommand(workCtx, userId, command)) return;
		if (command === "/my_applications" || command === "/my_apps") {
			await renderOwnApplications(workCtx, options, userId);
			return;
		}
		if (command === "/feed") {
			await openFeed(workCtx, options, userId);
			return;
		}
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
		await next();
	});
	callbackRoute.use(profileFeature.composer);
	callbackRoute.use(collaborationFeature.composer);
	callbackRoute.on("callback_query:data", async (workCtx) => {
		const data = workCtx.callbackQuery.data;
		const browseMutation = parseBrowseMutation(data);
		const applicationStart = parseApplicationStart(data);
		if (!ROOT_STATIC_CALLBACKS.has(data) && browseMutation === undefined && applicationStart === undefined) return;
		const userId = String(workCtx.from.id);
		if (browseMutation !== undefined) {
			await handleBrowseMutation(workCtx, options, userId, browseMutation);
			return;
		}
		if (applicationStart !== undefined) {
			await handleApplicationStart(workCtx, options, profileFeature, userId, applicationStart);
			return;
		}
		switch (data) {
		case "menu:home":
			await renderMenu(workCtx, options, profileFeature, collaborationFeature, userId);
			return;
		case "profile:unavailable":
			await workCtx.reply("Этот раздел пока готовится. Сейчас вы можете создать и отредактировать профиль.", { reply_markup: menuKeyboard(options) });
			return;
		case "application:own":
			await renderOwnApplications(workCtx, options, userId);
			return;
		case "browse:start":
			await openFeed(workCtx, options, userId);
			return;
		}
	});

	registerDurableTelegramIngress(bot, {
		executeDurably: (ctx, input, route) => runDurable(ctx, options, profileFeature, input, route),
		messageRoute: messageRoute.middleware(),
		callbackRoute: callbackRoute.middleware(),
		opaqueCallbackRoute: async (ctx) => {
			const data = ctx.callbackQuery?.data;
			if (data !== undefined) await handleOpaqueCallback(ctx, options, data);
		},
	});

	return { profileService: options.profileService };
}

async function handleAdminCommand(ctx: Context, options: ProfileBotOptions, userId: string, text: string): Promise<void> {
	const moderation = options.adminModerationService;
	if (moderation === undefined) {
		await replyUnknownCommand(ctx, options);
		return;
	}
	const body = text.trim().slice("/admin".length).trim();
	if (body === "") {
		await ctx.reply("Укажите полную ссылку на карточку. Для скрытия используйте: /admin hide <ссылка> <причина>.");
		return;
	}
	if (body.toLowerCase() === "hide" || body.toLowerCase().startsWith("hide ")) {
		const hideBody = body.slice("hide".length).trim();
		const separator = hideBody.search(/\s/);
		if (separator < 0) {
			await ctx.reply("Укажите полную ссылку и внутреннюю причину скрытия от 1 до 500 символов.");
			return;
		}
		const deepLink = hideBody.slice(0, separator);
		const reason = hideBody.slice(separator).trim();
		const updateId = getUpdateId(ctx.update);
		if (updateId === undefined) return;
		const result = await moderation.hide({
			adminTelegramUserId: userId,
			commandId: `telegram:update:${updateId}`,
			deepLink,
			reason,
		});
		if (result.ok) {
			await ctx.reply("Карточка скрыта. Публикация поставлена на удаление.");
			return;
		}
		switch (result.code) {
			case "invalid_reason":
				await ctx.reply("Причина после удаления пробелов должна содержать от 1 до 500 символов.");
				return;
			case "already_hidden":
				await ctx.reply("Карточка уже скрыта.");
				return;
			case "invalid_link":
				await ctx.reply("Не удалось распознать ссылку на карточку этого бота.");
				return;
			case "not_found":
				await ctx.reply("Карточка не найдена.");
				return;
			case "forbidden":
				await replyUnknownCommand(ctx, options);
				return;
			case "unavailable":
				await ctx.reply("Эту карточку сейчас нельзя скрыть.");
				return;
		}
	}
	if (/\s/.test(body)) {
		await ctx.reply("Укажите одну полную ссылку на карточку.");
		return;
	}
	const result = await moderation.lookup({ adminTelegramUserId: userId, deepLink: body });
	if (result.ok) {
		await ctx.reply(`Карточка найдена.\nНазвание: ${result.title}\nСтатус: ${collaborationStatusLabel(result.status)}`);
		return;
	}
	if (result.code === "forbidden") {
		await replyUnknownCommand(ctx, options);
		return;
	}
	await ctx.reply(result.code === "invalid_link" ? "Не удалось распознать ссылку на карточку этого бота." : "Карточка не найдена.");
}

function replyUnknownCommand(ctx: Context, options: ProfileBotOptions): Promise<unknown> {
	return ctx.reply("Не удалось распознать команду. Откройте главное меню командой /start или воспользуйтесь /help.", { reply_markup: menuKeyboard(options) });
}

type ReplyOptions = Parameters<Context["reply"]>[1];
type AnswerOptions = Parameters<Context["answerCallbackQuery"]>[0];
interface ReplyAction {
	readonly text: string;
	readonly options?: ReplyOptions;
}

interface ProfileAudienceAction {
	readonly plan: ProfileAudiencePlan;
	readonly replyIndex: number;
}

const REPLY_COLLECTOR = Symbol("reply-collector");
type CollectedContext = Context & { readonly [REPLY_COLLECTOR]?: ReplyCollector };

class ReplyCollector {
	readonly replies: ReplyAction[] = [];
	readonly answers: AnswerOptions[] = [];
	private audienceAction: ProfileAudienceAction | undefined;

	context(ctx: Context): Context {
		const proxy = Object.create(ctx) as Context;
		Object.defineProperty(proxy, REPLY_COLLECTOR, { value: this });
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

	scheduleAudience(plan: ProfileAudiencePlan): void {
		if (this.audienceAction !== undefined) throw new Error("only one profile audience action may be scheduled per update");
		const replyIndex = this.replies.length - 1;
		if (replyIndex < 0) throw new Error("profile audience action requires a saved-profile reply");
		this.audienceAction = { plan, replyIndex };
	}

	takeAudienceAction(): ProfileAudienceAction | undefined {
		return this.audienceAction;
	}

	appendToReply(replyIndex: number, line: string): void {
		const reply = this.replies[replyIndex];
		if (reply === undefined) throw new Error("profile audience reply target is missing");
		this.replies[replyIndex] = { ...reply, text: `${reply.text}\n\n${line}` };
	}
}

function scheduleProfileAudience(
	ctx: Context,
	options: ProfileBotOptions,
	profile: ProfileRecord,
	draft: ProfileDraft,
): void {
	const plan = options.profileAudienceService?.plan(profile, draft.audienceAutofill ?? "allow");
	if (plan === undefined) return;
	const collector = (ctx as CollectedContext)[REPLY_COLLECTOR];
	if (collector === undefined) throw new Error("profile audience action must use a durable reply collector");
	collector.scheduleAudience(plan);
}

async function runDurable(
	ctx: Context,
	options: ProfileBotOptions,
	profileFeature: ProfileTelegramFeature,
	input: CanonicalInput,
	effect: (workContext: Context) => Promise<void>,
): Promise<void> {
	const updateId = getUpdateId(ctx.update);
	const from = ctx.from;
	if (updateId === undefined || from === undefined) return;
	const collector = new ReplyCollector();
	const workContext = collector.context(ctx);
	const telegramUserId = String(from.id);
	const actor = isAdminCommandInput(input) && options.adminModerationService?.isAdminTelegramUserId(telegramUserId) === true
		? { kind: "admin" as const, telegramUserId }
		: { kind: "telegram_user" as const, telegramUserId };
	await options.durableCommandExecutor.execute({
		context: {
			commandId: `telegram:update:${updateId}`,
			telegramUpdateId: updateId,
			actor,
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
		const session = await profileFeature.findSession(String(from.id));
		if (session !== undefined) await ctx.reply("Запрос уже обработан. Текущий шаг сохранён.", { reply_markup: resumeKeyboard(session) });
		else if (await options.profileService.getOwn(String(from.id)) !== undefined) await ctx.reply("Запрос уже обработан. Профиль уже сохранён.", { reply_markup: menuKeyboard(options) });
		else await ctx.reply("Запрос уже обработан.", { reply_markup: menuKeyboard(options) });
		return;
	}
	for (const answer of collector.answers) {
		if (answer === undefined) await ctx.answerCallbackQuery();
		else await ctx.answerCallbackQuery(answer);
	}
	let postCommitError: unknown;
	const audienceAction = collector.takeAudienceAction();
	if (audienceAction !== undefined && options.profileAudienceService !== undefined) {
		try {
			const outcome = await options.profileAudienceService.execute(audienceAction.plan);
			collector.appendToReply(
				audienceAction.replyIndex,
				outcome.kind === "applied"
					? `Аудитория Telegram: ${outcome.audienceSize} — снимок на момент сохранения.`
					: AUDIENCE_SNAPSHOT_UNAVAILABLE,
			);
		} catch (error) {
			collector.appendToReply(audienceAction.replyIndex, AUDIENCE_SNAPSHOT_UNAVAILABLE);
			postCommitError = error;
		}
	}
	for (const reply of collector.replies) {
		if (reply.options === undefined) await ctx.reply(reply.text);
		else await ctx.reply(reply.text, reply.options);
	}
	if (postCommitError !== undefined) throw postCommitError;
}

function isAdminCommandInput(input: CanonicalInput): boolean {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
	const record = input as { readonly kind?: unknown; readonly text?: unknown };
	if (record.kind !== "message" || typeof record.text !== "string") return false;
	return record.text.trim().split(/\s+/, 1)[0]?.toLowerCase() === "/admin";
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

async function renderMenu(
	ctx: Context,
	options: ProfileBotOptions,
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

async function renderManagedCollaborations(ctx: Context, options: ProfileBotOptions, userId: string): Promise<readonly string[]> {
	const management = options.applicationService === undefined ? [] : await options.applicationService.listAuthorManagement(userId);
	for (const card of management) await renderAuthorManagement(ctx, options, userId, card);
	return management.map((card) => card.collaborationId);
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

async function handleApplicationStart(
	ctx: Context,
	options: ProfileBotOptions,
	profileFeature: ProfileTelegramFeature,
	userId: string,
	start: ApplicationStart,
): Promise<void> {
	const browseService = options.collaborationBrowseService;
	const applicationService = options.applicationService;
	if (browseService === undefined || applicationService === undefined) {
		await ctx.reply("Отклик сейчас недоступен.", { reply_markup: menuKeyboard(options) });
		return;
	}
	const currentSession = await profileFeature.findSession(userId);
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
		await profileFeature.startApplicationMessage(ctx, userId, continuation);
		return;
	}
	if (eligibility.code === "profile_required") {
		await profileFeature.startQuickApplicationProfile(ctx, userId, continuation);
		return;
	}
	await replyApplicationFailure(ctx, options, eligibility.code);
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
	session?: ProfileSessionIdentity,
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
