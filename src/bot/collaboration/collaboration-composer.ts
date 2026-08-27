import { Composer, type Context, type InlineKeyboard } from "grammy";

import {
	CollaborationDraftStaleError,
	CollaborationProfileRequiredError,
	CollaborationWizardConflictError,
	type CollaborationDraftService,
	type CollaborationDraftStartResult,
} from "../../application/collaborations/collaboration-draft-service.js";
import { CollaborationNotPublishableError, PublicationUnavailableError, type CollaborationPublicationService } from "../../application/collaborations/collaboration-publication-service.js";
import { renderCollaborationCard } from "../../application/collaborations/collaboration-renderer.js";
import type { CollaborationSessionRecord } from "../../application/ports/collaboration-session-repository.js";
import type { ProfileSessionRecord } from "../../modules/profiles/application/index.js";
import type { CollaborationDraftInput, CollaborationWizardStep } from "../../domain/collaborations/collaboration.js";
import { DomainValidationError } from "../../domain/value-objects/enums.js";
import {
	collaborationCallbackInput,
	collaborationKeyboard,
	collaborationStatusLabel,
	parseCollaborationMutationCallback,
	parseCollaborationTopics,
	previousCollaborationStep,
	type CollaborationMutation,
} from "./collaboration-presentation.js";

export type CollaborationDraftCommands = Pick<CollaborationDraftService, "start" | "saveStep" | "cancel" | "findDraft" | "findSession">;
export type CollaborationPublicationCommands = Pick<CollaborationPublicationService, "publish" | "listOwn">;

export interface CollaborationProfileFlow {
	findSession(userId: string): Promise<ProfileSessionRecord | undefined>;
	hasOwnProfile(userId: string): Promise<boolean>;
	startForCollaboration(ctx: Context, userId: string): Promise<void>;
	resumeKeyboard(session: ProfileSessionRecord): InlineKeyboard;
}

export interface CollaborationTelegramFeatureOptions {
	readonly draftService?: CollaborationDraftCommands;
	readonly publicationService?: CollaborationPublicationCommands;
	readonly menuKeyboard: () => InlineKeyboard;
	readonly profileFlow: CollaborationProfileFlow;
	readonly renderManagedCollaborations: (ctx: Context, userId: string) => Promise<readonly string[]>;
}

export interface CollaborationTelegramFeature {
	readonly composer: Composer<Context>;
	routeCommand(ctx: Context, userId: string, command: string | undefined): Promise<boolean>;
	isActive(userId: string): Promise<boolean>;
	continueAfterProfile(ctx: Context, userId: string): Promise<(() => Promise<void>) | undefined>;
}

export function createCollaborationTelegramFeature(options: CollaborationTelegramFeatureOptions): CollaborationTelegramFeature {
	const composer = new Composer<Context>();
	composer.on("message:text", async (ctx, next) => {
		const from = ctx.from;
		if (from === undefined) {
			await next();
			return;
		}
		const userId = String(from.id);
		const command = ctx.message.text.trim().split(/\s+/, 1)[0]?.toLowerCase();
		if (await routeCommand(ctx, options, userId, command)) return;
		if (await options.profileFlow.findSession(userId) !== undefined) {
			await next();
			return;
		}
		const session = await options.draftService?.findSession(userId);
		if (session === undefined) {
			await next();
			return;
		}
		await advanceCollaborationText(ctx, options, userId, session, ctx.message.text);
	});
	composer.on("callback_query:data", async (ctx, next) => {
		const from = ctx.from;
		if (from === undefined) {
			await next();
			return;
		}
		const data = ctx.callbackQuery.data;
		const userId = String(from.id);
		const mutation = parseCollaborationMutationCallback(data);
		if (mutation !== undefined) {
			await handleCollaborationMutation(ctx, options, userId, mutation);
			return;
		}
		switch (data) {
		case "collaboration:start":
		case "collaboration:resume":
			await startOrResumeCollaboration(ctx, options, userId);
			return;
		case "collaboration:own":
			await renderOwnCollaborations(ctx, options, userId);
			return;
		default:
			await next();
		}
	});

	return {
		composer,
		routeCommand: (ctx, userId, command) => routeCommand(ctx, options, userId, command),
		isActive: (userId) => isActive(options, userId),
		continueAfterProfile: async (ctx, userId) => {
			const service = options.draftService;
			if (service === undefined) return undefined;
			try {
				const started = await service.start(userId);
				return () => renderCollaborationStep(ctx, options, started);
			} catch (error) {
				if (error instanceof CollaborationProfileRequiredError) return undefined;
				throw error;
			}
		},
	};
}

async function routeCommand(ctx: Context, options: CollaborationTelegramFeatureOptions, userId: string, command: string | undefined): Promise<boolean> {
	if (command === "/cancel") {
		if (!(await isActive(options, userId))) return false;
		await options.draftService?.cancel(userId);
		await ctx.reply("Черновик коллаборации отменён.", { reply_markup: options.menuKeyboard() });
		return true;
	}
	if (command === "/new") {
		await startOrResumeCollaboration(ctx, options, userId);
		return true;
	}
	if (command === "/my_collaborations") {
		await renderOwnCollaborations(ctx, options, userId);
		return true;
	}
	return false;
}

async function isActive(options: CollaborationTelegramFeatureOptions, userId: string): Promise<boolean> {
	const service = options.draftService;
	return service !== undefined && (await service.findSession(userId) !== undefined || await service.findDraft(userId) !== undefined);
}

async function startOrResumeCollaboration(ctx: Context, options: CollaborationTelegramFeatureOptions, userId: string): Promise<void> {
	const service = options.draftService;
	if (service === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const profileSession = await options.profileFlow.findSession(userId);
	if (profileSession !== undefined) {
		await ctx.reply("Сначала завершите заполнение профиля — после сохранения продолжим создание коллаборации.", { reply_markup: options.profileFlow.resumeKeyboard(profileSession) });
		return;
	}
	if (!(await options.profileFlow.hasOwnProfile(userId))) {
		await ctx.reply("Чтобы создать коллаборацию, сначала заполним короткий профиль.");
		await options.profileFlow.startForCollaboration(ctx, userId);
		return;
	}
	try {
		await renderCollaborationStep(ctx, options, await service.start(userId));
	} catch (error) {
		if (error instanceof CollaborationWizardConflictError) {
			await ctx.reply("Сначала завершите уже открытое заполнение.", { reply_markup: options.menuKeyboard() });
			return;
		}
		throw error;
	}
}

async function renderCollaborationStep(ctx: Context, options: CollaborationTelegramFeatureOptions, started: CollaborationDraftStartResult): Promise<void> {
	const session = started.session;
	const state = session.state;
	const markup = collaborationKeyboard(state, session.revision, options.publicationService !== undefined);
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

async function advanceCollaborationText(ctx: Context, options: CollaborationTelegramFeatureOptions, userId: string, session: CollaborationSessionRecord, text: string): Promise<void> {
	const service = options.draftService;
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
				await renderCollaborationStep(ctx, options, { draft: await service.findDraft(userId) as NonNullable<Awaited<ReturnType<CollaborationDraftCommands["findDraft"]>>>, session, resumed: true });
				return;
		}
		await renderCollaborationStep(ctx, options, await service.saveStep(userId, session, input, nextStep));
	} catch (error) {
		if (error instanceof DomainValidationError) {
			await ctx.reply("Значение не подходит — исправьте его, предыдущее корректное значение сохранено.", { reply_markup: collaborationKeyboard(session.state, session.revision, options.publicationService !== undefined) });
			return;
		}
		if (error instanceof CollaborationDraftStaleError) {
			await ctx.reply("Этот экран уже устарел. Откройте продолжение коллаборации из меню.", { reply_markup: options.menuKeyboard() });
			return;
		}
		throw error;
	}
}

async function handleCollaborationMutation(ctx: Context, options: CollaborationTelegramFeatureOptions, userId: string, mutation: CollaborationMutation): Promise<void> {
	const service = options.draftService;
	if (service === undefined) return;
	const session = await service.findSession(userId);
	if (session === undefined || session.revision !== mutation.revision || session.state.generation !== mutation.generation) {
		if (mutation.kind === "cancel") {
			if (await service.findDraft(userId) === undefined) await ctx.reply("Этот черновик уже отменён.", { reply_markup: options.menuKeyboard() });
			else await ctx.reply("Этот экран уже устарел. Откройте продолжение коллаборации из меню.", { reply_markup: options.menuKeyboard() });
			return;
		}
		await ctx.reply("Этот экран уже устарел. Откройте продолжение коллаборации из меню.", { reply_markup: options.menuKeyboard() });
		return;
	}
	if (mutation.kind === "cancel") {
		await service.cancel(userId, session);
		await ctx.reply("Черновик коллаборации отменён.", { reply_markup: options.menuKeyboard() });
		return;
	}
	if (mutation.kind === "publish") {
		if (options.publicationService === undefined) return;
		try {
			await options.publicationService.publish(userId, session.collaborationId);
			await ctx.reply("Публикация запущена.", { reply_markup: options.menuKeyboard() });
		} catch (error) {
			if (error instanceof PublicationUnavailableError) { await ctx.reply("Публикация временно недоступна. Черновик сохранён.", { reply_markup: collaborationKeyboard(session.state, session.revision, true) }); return; }
			if (error instanceof CollaborationNotPublishableError) { await ctx.reply("Карточка уже опубликована или не готова к публикации.", { reply_markup: options.menuKeyboard() }); return; }
			throw error;
		}
		return;
	}
	if (mutation.kind === "back") {
		const previous = previousCollaborationStep(session.state.step);
		if (previous === undefined) {
			await ctx.reply("Черновик сохранён. Вы можете продолжить его из меню.", { reply_markup: options.menuKeyboard() });
			return;
		}
		await renderCollaborationStep(ctx, options, await service.saveStep(userId, session, {}, previous));
		return;
	}
	if (mutation.kind === "preview") {
		try {
			await renderCollaborationStep(ctx, options, await service.saveStep(userId, session, {}, "preview"));
		} catch (error) {
			if (error instanceof DomainValidationError) await ctx.reply("Заполните все поля корректно, чтобы открыть предпросмотр.", { reply_markup: collaborationKeyboard(session.state, session.revision, options.publicationService !== undefined) });
			else throw error;
		}
		return;
	}
	const next = collaborationCallbackInput(mutation);
	if (next === undefined) return;
	try {
		await renderCollaborationStep(ctx, options, await service.saveStep(userId, session, next.input, next.step));
	} catch (error) {
		if (error instanceof DomainValidationError) await ctx.reply("Выберите корректное значение.", { reply_markup: collaborationKeyboard(session.state, session.revision, options.publicationService !== undefined) });
		else throw error;
	}
}

async function renderOwnCollaborations(ctx: Context, options: CollaborationTelegramFeatureOptions, userId: string): Promise<void> {
	if (options.publicationService === undefined) {
		await ctx.reply("Этот раздел пока готовится.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const summaries = await options.publicationService.listOwn(userId);
	const managedIds = await options.renderManagedCollaborations(ctx, userId);
	if (summaries.length === 0 && managedIds.length === 0) {
		await ctx.reply("У вас пока нет коллабораций.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const managed = new Set(managedIds);
	const other = summaries.filter((summary) => !managed.has(summary.collaborationId));
	if (other.length > 0) {
		const lines = other.map((summary) => `• ${summary.title ?? "Без названия"} — ${collaborationStatusLabel(summary.status)}`);
		await ctx.reply(`Мои коллаборации\n\n${lines.join("\n")}`, { reply_markup: options.menuKeyboard() });
	}
}
