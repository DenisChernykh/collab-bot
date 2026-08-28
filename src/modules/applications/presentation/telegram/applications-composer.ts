import { Composer, InlineKeyboard, type Context } from "grammy";

import type { CallbackActionService } from "../../../../application/commands/callback-action.js";
import type { SafeResult } from "../../../../application/commands/safe-result.js";
import type { Clock } from "../../../../shared/application/ports/clock.js";
import type { ProfileType, Topic } from "../../../../shared/domain/value-objects/enums.js";
import { collaborationStatusLabel } from "../../../collaborations/index.js";
import type { ApplicationFailureCode, AuthorManagementView } from "../../application/application-contracts.js";
import type { ApplicationsFeatureApi } from "../../application/application-feature.js";
import {
	parseApplicationsCallback,
	type ApplicationStart,
} from "./application-callback-codec.js";

const CALLBACK_ACTION_TTL_MS = 24 * 60 * 60 * 1_000;

export interface ApplicationContinuation {
	readonly kind: "submit_application";
	readonly collaborationId: string;
	readonly source: "feed" | "deep_link";
}

export interface ApplicationsProfileFlow {
	activeSessionKeyboard(userId: string): Promise<InlineKeyboard | undefined>;
	startApplicationMessage(ctx: Context, userId: string, continuation: ApplicationContinuation): Promise<void>;
	startQuickApplicationProfile(ctx: Context, userId: string, continuation: ApplicationContinuation): Promise<void>;
}

export type ApplicationsTargetResolution =
	| { readonly kind: "card"; readonly collaborationId: string }
	| { readonly kind: "handled" };

export interface ApplicationsTargetFlow {
	resolveApplicationTarget(ctx: Context, userId: string, publicToken: string): Promise<ApplicationsTargetResolution>;
	renderApplicationTarget(ctx: Context, userId: string, publicToken: string): Promise<void>;
}

export interface ApplicationsTelegramFeatureOptions {
	readonly applicationsApi?: ApplicationsFeatureApi;
	readonly callbackActionService?: CallbackActionService;
	readonly clock: Clock;
	readonly menuKeyboard: () => InlineKeyboard;
	readonly profileFlow: ApplicationsProfileFlow;
	readonly targetFlow: ApplicationsTargetFlow;
	readonly profileTypeLabel: (value: ProfileType) => string;
	readonly topicLabel: (value: Topic) => string;
	readonly upsertActorSnapshot: (ctx: Context) => Promise<void>;
	readonly occurredAt: (ctx: Context) => Date;
	readonly getUpdateId: (ctx: Context) => number | undefined;
}

export interface ApplicationsTelegramFeature {
	readonly composer: Composer<Context>;
	routeStart(ctx: Context, userId: string, startParameter: string): Promise<boolean>;
	routeCommand(ctx: Context, userId: string, command: string | undefined): Promise<boolean>;
	renderManagedCollaborations(ctx: Context, userId: string): Promise<readonly string[]>;
	reopenApplicationCard(ctx: Context, userId: string, collaborationId: string): Promise<void>;
	replyApplicationFailure(ctx: Context, code: ApplicationFailureCode, retryKeyboard?: InlineKeyboard, profileWasSaved?: boolean): Promise<void>;
	handleOpaqueCallback(ctx: Context, callbackPayload: string): Promise<void>;
}

export function createApplicationsTelegramFeature(options: ApplicationsTelegramFeatureOptions): ApplicationsTelegramFeature {
	const composer = new Composer<Context>();
	composer.on("callback_query:data", async (ctx, next) => {
		const callback = parseApplicationsCallback(ctx.callbackQuery.data);
		if (callback === undefined || ctx.from === undefined) {
			await next();
			return;
		}
		const userId = String(ctx.from.id);
		if (callback.kind === "own_applications") {
			await renderOwnApplications(ctx, options, userId);
			return;
		}
		await handleApplicationStart(ctx, options, userId, callback.start);
	});

	return {
		composer,
		routeStart: async (ctx, userId, startParameter) => {
			if (!/^c_[A-Za-z0-9_-]{22}$/.test(startParameter) || options.applicationsApi === undefined) return false;
			const management = await options.applicationsApi.getAuthorManagementByPublicToken(userId, startParameter.slice(2));
			if (management === undefined) return false;
			await renderAuthorManagement(ctx, options, userId, management);
			return true;
		},
		routeCommand: async (ctx, userId, command) => {
			if (command !== "/my_applications" && command !== "/my_apps") return false;
			await renderOwnApplications(ctx, options, userId);
			return true;
		},
		renderManagedCollaborations: (ctx, userId) => renderManagedCollaborations(ctx, options, userId),
		reopenApplicationCard: (ctx, userId, collaborationId) => reopenApplicationCard(ctx, options, userId, collaborationId),
		replyApplicationFailure: (ctx, code, retryKeyboard, profileWasSaved) => replyApplicationFailure(ctx, options, code, retryKeyboard, profileWasSaved),
		handleOpaqueCallback: (ctx, callbackPayload) => handleOpaqueCallback(ctx, options, callbackPayload),
	};
}

async function handleOpaqueCallback(ctx: Context, options: ApplicationsTelegramFeatureOptions, callbackPayload: string): Promise<void> {
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

async function renderManagedCollaborations(ctx: Context, options: ApplicationsTelegramFeatureOptions, userId: string): Promise<readonly string[]> {
	const management = options.applicationsApi === undefined ? [] : await options.applicationsApi.listAuthorManagement(userId);
	for (const card of management) await renderAuthorManagement(ctx, options, userId, card);
	return management.map((card) => card.collaborationId);
}

async function renderOwnApplications(ctx: Context, options: ApplicationsTelegramFeatureOptions, userId: string): Promise<void> {
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
	options: ApplicationsTelegramFeatureOptions,
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
			`Тип: ${options.profileTypeLabel(applicant.type)}`,
			...(applicant.description === null ? [] : [`Описание: ${applicant.description}`]),
			...(applicant.topics.length === 0 ? [] : [`Темы: ${applicant.topics.map(options.topicLabel).join(", ")}`]),
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
	options: ApplicationsTelegramFeatureOptions,
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

async function handleApplicationStart(ctx: Context, options: ApplicationsTelegramFeatureOptions, userId: string, start: ApplicationStart): Promise<void> {
	const applications = options.applicationsApi;
	if (applications === undefined) {
		await ctx.reply("Отклик сейчас недоступен.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const activeKeyboard = await options.profileFlow.activeSessionKeyboard(userId);
	if (activeKeyboard !== undefined) {
		await ctx.reply("Сначала завершите или отмените текущее заполнение.", { reply_markup: activeKeyboard });
		return;
	}
	const target = await options.targetFlow.resolveApplicationTarget(ctx, userId, start.publicToken);
	if (target.kind === "handled") return;
	const eligibility = await applications.checkEligibility({
		telegramUserId: userId,
		collaborationId: target.collaborationId,
		occurredAt: options.occurredAt(ctx).getTime(),
	});
	const continuation: ApplicationContinuation = { kind: "submit_application", collaborationId: target.collaborationId, source: start.source };
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

async function reopenApplicationCard(ctx: Context, options: ApplicationsTelegramFeatureOptions, userId: string, collaborationId: string): Promise<void> {
	const applications = options.applicationsApi;
	if (applications === undefined) {
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
	await options.targetFlow.renderApplicationTarget(ctx, userId, publicToken);
}

async function replyApplicationFailure(
	ctx: Context,
	options: ApplicationsTelegramFeatureOptions,
	code: ApplicationFailureCode,
	retryKeyboard?: InlineKeyboard,
	profileWasSaved = false,
): Promise<void> {
	if (code === "invalid_message") {
		await ctx.reply("Сообщение должно содержать от 10 до 500 символов.", { reply_markup: retryKeyboard ?? options.menuKeyboard() });
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
