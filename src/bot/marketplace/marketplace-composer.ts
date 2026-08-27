import { Composer, InlineKeyboard, type Context } from "grammy";

import type { CallbackActionService } from "../../application/commands/callback-action.js";
import type { SafeResult } from "../../application/commands/safe-result.js";
import {
	BrowseSessionStaleError,
	type CollaborationBrowseService,
	type BrowseFilterDimension,
	type BrowseFilterValue,
	type BrowsePage,
} from "../../application/collaborations/collaboration-browse-service.js";
import { renderCollaborationCard } from "../../application/collaborations/collaboration-renderer.js";
import type { Clock } from "../../application/ports/clock.js";
import type { BrowseCollaborationRecord, BrowseSessionRecord } from "../../application/ports/collaboration-browse-repository.js";
import type { ProfileSessionRecord } from "../../modules/profiles/application/index.js";
import { DomainValidationError, type CollaborationFormat, type Topic } from "../../domain/value-objects/enums.js";
import type { ApplicationsFeatureApi, ApplicationFailureCode, AuthorManagementView } from "../../modules/applications/index.js";
import { COLLABORATION_FORMAT_LABELS, collaborationStatusLabel } from "../collaboration/collaboration-presentation.js";
import {
	PROFILE_TYPE_LABELS,
	TOPIC_LABELS,
	applicationNavigationKeyboard,
	profileTypeLabel,
	resumeKeyboard,
	topicLabel,
	type ApplicationContinuation,
	type ProfileSessionIdentity,
} from "../profile/profile-presentation.js";
import {
	applicationStartCallback,
	browseCallback,
	parseMarketplaceCallback,
	type ApplicationStart,
	type BrowseMutation,
} from "./marketplace-callback-codec.js";

const CALLBACK_ACTION_TTL_MS = 24 * 60 * 60 * 1_000;

export interface MarketplaceProfileFlow {
	findSession(userId: string): Promise<ProfileSessionRecord | undefined>;
	startApplicationMessage(ctx: Context, userId: string, continuation: ApplicationContinuation): Promise<void>;
	startQuickApplicationProfile(ctx: Context, userId: string, continuation: ApplicationContinuation): Promise<void>;
}

export interface MarketplaceTelegramFeatureOptions {
	readonly applicationsApi?: ApplicationsFeatureApi;
	readonly collaborationBrowseService?: CollaborationBrowseService;
	readonly callbackActionService?: CallbackActionService;
	readonly clock: Clock;
	readonly menuKeyboard: () => InlineKeyboard;
	readonly profileFlow: MarketplaceProfileFlow;
	readonly upsertActorSnapshot: (ctx: Context) => Promise<void>;
	readonly occurredAt: (ctx: Context) => Date;
	readonly getUpdateId: (ctx: Context) => number | undefined;
}

export interface MarketplaceTelegramFeature {
	readonly composer: Composer<Context>;
	routeStart(ctx: Context, userId: string, startParameter: string): Promise<boolean>;
	routeCommand(ctx: Context, userId: string, command: string | undefined): Promise<boolean>;
	renderManagedCollaborations(ctx: Context, userId: string): Promise<readonly string[]>;
	reopenApplicationCard(ctx: Context, userId: string, collaborationId: string): Promise<void>;
	replyApplicationFailure(
		ctx: Context,
		code: ApplicationFailureCode,
		session?: ProfileSessionIdentity,
		profileWasSaved?: boolean,
	): Promise<void>;
	handleOpaqueCallback(ctx: Context, callbackPayload: string): Promise<void>;
}

export function createMarketplaceTelegramFeature(options: MarketplaceTelegramFeatureOptions): MarketplaceTelegramFeature {
	const feature: MarketplaceTelegramFeature = {
		composer: new Composer<Context>(),
		routeStart: async (ctx, userId, startParameter) => {
			if (!startParameter.startsWith("c_")) return false;
			await renderDeepLink(ctx, options, userId, startParameter);
			return true;
		},
		routeCommand: async (ctx, userId, command) => {
			if (command === "/my_applications" || command === "/my_apps") {
				await renderOwnApplications(ctx, options, userId);
				return true;
			}
			if (command === "/feed") {
				await openFeed(ctx, options, userId);
				return true;
			}
			return false;
		},
		renderManagedCollaborations: (ctx, userId) => renderManagedCollaborations(ctx, options, userId),
		reopenApplicationCard: (ctx, userId, collaborationId) => reopenApplicationCard(ctx, options, userId, collaborationId),
		replyApplicationFailure: (ctx, code, session, profileWasSaved) => replyApplicationFailure(ctx, options, code, session, profileWasSaved),
		handleOpaqueCallback: (ctx, callbackPayload) => handleOpaqueCallback(ctx, options, callbackPayload),
	};

	feature.composer.on("callback_query:data", async (ctx, next) => {
		const callback = parseMarketplaceCallback(ctx.callbackQuery.data);
		if (callback === undefined || ctx.from === undefined) {
			await next();
			return;
		}
		const userId = String(ctx.from.id);
		switch (callback.kind) {
			case "open_feed":
				await openFeed(ctx, options, userId);
				return;
			case "own_applications":
				await renderOwnApplications(ctx, options, userId);
				return;
			case "browse":
				await handleBrowseMutation(ctx, options, userId, callback.mutation);
				return;
			case "start_application":
				await handleApplicationStart(ctx, options, userId, callback.start);
				return;
		}
	});

	return feature;
}

async function handleOpaqueCallback(ctx: Context, options: MarketplaceTelegramFeatureOptions, callbackPayload: string): Promise<void> {
	const from = ctx.from;
	const updateId = options.getUpdateId(ctx);
	if (ctx.callbackQuery?.message?.chat.type !== "private" || from === undefined || updateId === undefined) {
		await ctx.answerCallbackQuery();
		return;
	}
	const callbackActions = options.callbackActionService;
	const applications = options.applicationsApi;
	if (callbackActions === undefined || applications === undefined) {
		await ctx.answerCallbackQuery();
		await ctx.reply("Действие сейчас недоступно или уже неактуально.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const userId = String(from.id);
	const occurredAt = options.occurredAt(ctx);
	const result = await callbackActions.invoke({
		context: {
			commandId: `telegram:update:${updateId}`,
			telegramUpdateId: updateId,
			actor: { kind: "telegram_user", telegramUserId: userId },
			occurredAt,
		},
		callbackPayload,
		effect: async (action): Promise<SafeResult> => {
			await options.upsertActorSnapshot(ctx);
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
		await ctx.reply("Решение сохранено.", { reply_markup: options.menuKeyboard() });
		return;
	}
	if (result.outcome === "stale") {
		await ctx.reply("Эта кнопка устарела и больше неактуальна. Откройте карточку заново.", { reply_markup: options.menuKeyboard() });
		return;
	}
	if (result.outcome === "expired") {
		await ctx.reply("Срок действия этой кнопки истёк. Откройте карточку заново.", { reply_markup: options.menuKeyboard() });
		return;
	}
	await ctx.reply("Действие недоступно или уже неактуально.", { reply_markup: options.menuKeyboard() });
}

function callbackConflict(): SafeResult {
	return { version: 1, outcome: "conflict", messageKey: "callback_unavailable" };
}

function parseCallbackEntity(value: string | null, kind: "application" | "collaboration"): string | undefined {
	if (value === null || !value.startsWith(`${kind}:`)) return undefined;
	const id = value.slice(kind.length + 1);
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
}

async function renderManagedCollaborations(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string): Promise<readonly string[]> {
	const management = options.applicationsApi === undefined ? [] : await options.applicationsApi.listAuthorManagement(userId);
	for (const card of management) await renderAuthorManagement(ctx, options, userId, card);
	return management.map((card) => card.collaborationId);
}

async function renderOwnApplications(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string): Promise<void> {
	const service = options.applicationsApi;
	if (service === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const applications = await service.listOwnApplications(userId);
	if (applications.length === 0) {
		await ctx.reply("У вас пока нет откликов.", { reply_markup: options.menuKeyboard() });
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
		await ctx.reply(lines.join("\n"), { reply_markup: keyboard ?? options.menuKeyboard() });
	}
}

async function renderAuthorManagement(
	ctx: Context,
	options: MarketplaceTelegramFeatureOptions,
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
	await ctx.reply(header.join("\n"), { reply_markup: headerKeyboard ?? options.menuKeyboard() });
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
			const contact = await options.applicationsApi?.getPairContact(userId, application.applicationId);
			if (contact?.ok) keyboard = new InlineKeyboard().url("Написать в Telegram", contact.url);
			else lines.push("Контакт сейчас недоступен.");
		}
		await ctx.reply(lines.join("\n"), keyboard === undefined ? undefined : { reply_markup: keyboard });
	}
}

async function createDecisionToken(
	options: MarketplaceTelegramFeatureOptions,
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
		expiresAt: options.clock.now().getTime() + CALLBACK_ACTION_TTL_MS,
	});
}

function applicationStatusLabel(status: string): string {
	return ({ pending: "ожидает решения", accepted: "принят", rejected: "отклонён", closed: "закрыт", withdrawn: "отозван" } as Record<string, string>)[status] ?? "недоступен";
}

async function openFeed(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string): Promise<void> {
	if (options.collaborationBrowseService === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: options.menuKeyboard() });
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

async function handleBrowseMutation(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string, mutation: BrowseMutation): Promise<void> {
	const service = options.collaborationBrowseService;
	if (service === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: options.menuKeyboard() });
		return;
	}
	try {
		switch (mutation.kind) {
			case "next": await renderBrowsePage(ctx, options, await service.next(userId, mutation)); return;
			case "reset": await renderBrowsePage(ctx, options, await service.reset(userId, mutation)); return;
			case "filters": await renderBrowseFilterDimensions(ctx, await service.touch(userId, mutation)); return;
			case "filter": {
				if (mutation.dimension === undefined) throw new BrowseSessionStaleError();
				await renderBrowseFilterValues(ctx, await service.touch(userId, mutation), mutation.dimension);
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

async function renderBrowsePage(ctx: Context, options: MarketplaceTelegramFeatureOptions, page: BrowsePage): Promise<void> {
	const current = options.collaborationBrowseService === undefined ? page : await options.collaborationBrowseService.revalidate(page);
	if (current.card === null) {
		await ctx.reply("Подходящих карточек пока нет. Измените фильтры или покажите выдачу сначала.", { reply_markup: browseEmptyKeyboard(current.session) });
		return;
	}
	await ctx.reply(renderCollaborationCard(current.card), { parse_mode: "HTML", reply_markup: browseCardKeyboard(current.card, current.session) });
}

async function renderDeepLink(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string, startParameter: string): Promise<void> {
	if (/^c_[A-Za-z0-9_-]{22}$/.test(startParameter) && options.applicationsApi !== undefined) {
		const management = await options.applicationsApi.getAuthorManagementByPublicToken(userId, startParameter.slice(2));
		if (management !== undefined) {
			await renderAuthorManagement(ctx, options, userId, management);
			return;
		}
	}
	const service = options.collaborationBrowseService;
	if (service === undefined) {
		await ctx.reply("Предложение недоступно.", { reply_markup: options.menuKeyboard() });
		return;
	}
	await renderDeepLinkResult(ctx, options, await service.openDeepLink(userId, startParameter));
}

async function renderDeepLinkResult(
	ctx: Context,
	options: MarketplaceTelegramFeatureOptions,
	result: Awaited<ReturnType<CollaborationBrowseService["openDeepLink"]>>,
): Promise<void> {
	switch (result.kind) {
		case "card": await ctx.reply(renderCollaborationCard(result.card), { parse_mode: "HTML", reply_markup: deepLinkCardKeyboard(result.card, result.actionable) }); return;
		case "expired": await ctx.reply("Срок откликов истёк.", { reply_markup: options.menuKeyboard() }); return;
		case "closed": await ctx.reply("Предложение закрыто.", { reply_markup: options.menuKeyboard() }); return;
		case "unavailable": await ctx.reply("Предложение недоступно.", { reply_markup: options.menuKeyboard() }); return;
	}
}

async function handleApplicationStart(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string, start: ApplicationStart): Promise<void> {
	const browseService = options.collaborationBrowseService;
	const applications = options.applicationsApi;
	if (browseService === undefined || applications === undefined) {
		await ctx.reply("Отклик сейчас недоступен.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const currentSession = await options.profileFlow.findSession(userId);
	if (currentSession !== undefined) {
		await ctx.reply("Сначала завершите или отмените текущее заполнение.", { reply_markup: resumeKeyboard(currentSession) });
		return;
	}
	const result = await browseService.openDeepLink(userId, `c_${start.publicToken}`);
	if (result.kind !== "card") {
		await renderDeepLinkResult(ctx, options, result);
		return;
	}
	const eligibility = await applications.checkEligibility({
		telegramUserId: userId,
		collaborationId: result.card.id,
		occurredAt: options.occurredAt(ctx).getTime(),
	});
	const continuation: ApplicationContinuation = { kind: "submit_application", collaborationId: result.card.id, source: start.source };
	if (eligibility.ok) {
		await options.profileFlow.startApplicationMessage(ctx, userId, continuation);
		return;
	}
	if (eligibility.code === "profile_required") {
		await options.profileFlow.startQuickApplicationProfile(ctx, userId, continuation);
		return;
	}
	await replyApplicationFailure(ctx, options, eligibility.code);
}

async function reopenApplicationCard(ctx: Context, options: MarketplaceTelegramFeatureOptions, userId: string, collaborationId: string): Promise<void> {
	const applications = options.applicationsApi;
	const browseService = options.collaborationBrowseService;
	if (applications === undefined || browseService === undefined) {
		await ctx.reply("Предложение недоступно.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const eligibility = await applications.checkEligibility({ telegramUserId: userId, collaborationId, occurredAt: options.occurredAt(ctx).getTime() });
	if (!eligibility.ok) {
		await replyApplicationFailure(ctx, options, eligibility.code);
		return;
	}
	const publicToken = eligibility.target.publicToken;
	if (publicToken === null) {
		await ctx.reply("Предложение недоступно.", { reply_markup: options.menuKeyboard() });
		return;
	}
	await renderDeepLinkResult(ctx, options, await browseService.openDeepLink(userId, `c_${publicToken}`));
}

async function replyApplicationFailure(
	ctx: Context,
	options: MarketplaceTelegramFeatureOptions,
	code: ApplicationFailureCode,
	session?: ProfileSessionIdentity,
	profileWasSaved = false,
): Promise<void> {
	if (code === "invalid_message") {
		await ctx.reply("Сообщение должно содержать от 10 до 500 символов.", { reply_markup: session === undefined ? options.menuKeyboard() : applicationNavigationKeyboard(session) });
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
	await ctx.reply(`${profileWasSaved ? "Профиль сохранён. " : ""}${text[code]}`, { reply_markup: options.menuKeyboard() });
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

function toBrowseFilterDimension(value: BrowseMutation["dimension"]): BrowseFilterDimension | undefined {
	if (value === "target") return "target_profile_type";
	if (value === "format" || value === "topic") return value;
	return undefined;
}

function browseCardKeyboard(card: BrowseCollaborationRecord, session: BrowseSessionRecord): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (card.publicToken !== null) keyboard.text("Откликнуться", applicationStartCallback("feed", card.publicToken)).row();
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
	if (actionable && card.publicToken !== null) keyboard.text("Откликнуться", applicationStartCallback("deep_link", card.publicToken)).row();
	return keyboard.text("Открыть ленту", "browse:start").row().text("← В главное меню", "menu:home");
}
