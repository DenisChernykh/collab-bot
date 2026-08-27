import { randomBytes, randomInt } from "node:crypto";

import { Composer, InlineKeyboard, Keyboard, type Context } from "grammy";

import type { ApplicationFailureCode, ApplicationsFeatureApi } from "../../modules/applications/index.js";
import type { Clock } from "../../application/ports/clock.js";
import {
	PROFILE_SESSION_TTL_MS,
	PROFILE_SESSION_VERSION,
	type ProfileDraft,
	type ProfileSessionRecord,
	type ProfileSessionRepository,
	type ProfileSessionState,
} from "../../application/ports/profile-session-repository.js";
import type { ProfileService } from "../../application/profiles/profile-service.js";
import type { AudienceAutofillIntent } from "../../application/profiles/profile-audience-service.js";
import type { ProfileInput, ProfileRecord } from "../../domain/profiles/profile.js";
import {
	parsePlatformType,
	parseProfileType,
	parseTopic,
	type PlatformType,
	type ProfileType,
	type Topic,
} from "../../domain/value-objects/enums.js";
import {
	PROFILE_LINK_CHOICE_HINT,
	PROFILE_LINK_PROMPT,
	applicationNavigationKeyboard,
	cancelKeyboard,
	isApplicationSession,
	isApplicationState,
	normalizeTelegramUsername,
	optionalKeyboard,
	platformKeyboard,
	profileTypeLabel,
	resumeKeyboard,
	reviewKeyboard,
	topicLabel,
	type ApplicationContinuation,
	type ApplicationProfileSession,
	type ApplicationProfileState,
	type ProfileSessionIdentity,
	type ProfileSessionToken,
	typeKeyboard,
} from "./profile-presentation.js";

const PROFILE_TYPE_INPUTS = new Map<string, ProfileType>([
	["blogger", "blogger"], ["блогер", "blogger"],
	["telegram_channel", "telegram_channel"], ["telegram-канал", "telegram_channel"], ["телеграм-канал", "telegram_channel"],
	["venue_or_brand", "venue_or_brand"], ["заведение или бренд", "venue_or_brand"],
]);
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
const DEFAULT_AUDIENCE_AUTOFILL: AudienceAutofillIntent = "allow";

type ContinueCreateCollaboration = (ctx: Context, userId: string) => Promise<(() => Promise<void>) | undefined>;

export interface ProfileTelegramFeatureOptions {
	readonly profileService: ProfileService;
	readonly sessionRepository: ProfileSessionRepository;
	readonly clock: Clock;
	readonly requestIdFactory?: () => number;
	readonly applicationService?: Pick<ApplicationsFeatureApi, "checkEligibility" | "submit">;
	readonly menuKeyboard: () => InlineKeyboard;
	readonly isCollaborationActive: (userId: string) => Promise<boolean>;
	readonly continueCreateCollaboration: ContinueCreateCollaboration;
	readonly scheduleProfileAudience: (ctx: Context, profile: ProfileRecord, draft: ProfileDraft) => void;
	readonly reopenApplicationCard: (ctx: Context, userId: string, collaborationId: string) => Promise<void>;
	readonly replyApplicationFailure: (
		ctx: Context,
		code: ApplicationFailureCode,
		session?: ProfileSessionIdentity,
		profileWasSaved?: boolean,
	) => Promise<void>;
	readonly occurredAt: (ctx: Context) => number;
}

export interface ProfileTelegramFeature {
	readonly composer: Composer<Context>;
	findSession(userId: string): Promise<ProfileSessionRecord | undefined>;
	startOrResume(ctx: Context, userId: string, edit: boolean, continuation?: ProfileSessionState["continuation"]): Promise<void>;
	startApplicationMessage(ctx: Context, userId: string, continuation: ApplicationContinuation): Promise<void>;
	startQuickApplicationProfile(ctx: Context, userId: string, continuation: ApplicationContinuation): Promise<void>;
}

export function createProfileTelegramFeature(options: ProfileTelegramFeatureOptions): ProfileTelegramFeature {
	const composer = new Composer<Context>();
	composer.on("message", async (ctx, next) => {
		const from = ctx.from;
		if (from === undefined) {
			await next();
			return;
		}
		const userId = String(from.id);
		const message = ctx.message;
		if (message.chat_shared !== undefined) {
			await handleChatShared(ctx, options, userId, message.chat_shared);
			return;
		}
		if (message.text === undefined) {
			await next();
			return;
		}
		const text = message.text;
		const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
		if (command === "/profile") {
			const session = await activeSession(options, userId);
			if (session !== undefined) {
				await ctx.reply("У вас есть незавершённое заполнение профиля.", { reply_markup: resumeKeyboard(session) });
				return;
			}
			await showProfile(ctx, options, userId);
			return;
		}
		if (command === "/cancel") {
			await cancelCurrentSession(ctx, options, userId);
			return;
		}
		const session = await activeSession(options, userId);
		if (session === undefined) {
			await next();
			return;
		}
		await advanceText(ctx, options, userId, session, text);
	});
	composer.on("callback_query:data", async (ctx, next) => {
		const from = ctx.from;
		if (from === undefined) {
			await next();
			return;
		}
		const data = ctx.callbackQuery.data;
		const userId = String(from.id);
		const mutation = parseProfileMutationCallback(data);
		if (mutation !== undefined) {
			switch (mutation.kind) {
				case "back":
					await backSession(ctx, options, userId, mutation);
					return;
				case "cancel":
					await cancelSession(ctx, options, userId, mutation);
					return;
				case "apply":
					await apply(ctx, options, userId, mutation);
					return;
				case "type":
					await chooseType(ctx, options, userId, mutation.value ?? "", mutation);
					return;
				case "platform":
					await choosePlatform(ctx, options, userId, mutation.value ?? "", requestIdFactory(options), mutation);
					return;
				case "omit":
					await omitOptional(ctx, options, userId, mutation);
					return;
			}
		}
		switch (data) {
		case "profile:create":
			await startOrResume(ctx, options, userId, false);
			return;
		case "profile:resume":
			await resume(ctx, options, userId);
			return;
		case "profile:view":
			await showProfile(ctx, options, userId);
			return;
		case "profile:edit":
			await startOrResume(ctx, options, userId, true);
			return;
		default:
			await next();
		}
	});

	return {
		composer,
		findSession: (userId) => activeSession(options, userId),
		startOrResume: (ctx, userId, edit, continuation) => startOrResume(ctx, options, userId, edit, continuation),
		startApplicationMessage: async (ctx, userId, continuation) => {
			const saved = await saveState(options, userId, {
				version: PROFILE_SESSION_VERSION,
				generation: createSessionGeneration(),
				step: "application_message",
				draft: { audienceAutofill: "allow" },
				continuation,
			});
			await renderStep(ctx, options, userId, saved);
		},
		startQuickApplicationProfile: async (ctx, userId, continuation) => {
			const saved = await saveState(options, userId, {
				version: PROFILE_SESSION_VERSION,
				generation: createSessionGeneration(),
				step: "type",
				draft: { description: null, topics: [], audienceAutofill: "allow" },
				continuation,
			});
			await ctx.reply("Чтобы откликнуться, создадим короткий профиль — это займёт около минуты.");
			await renderStep(ctx, options, userId, saved);
		},
	};
}

type ProfileMutationKind = "back" | "cancel" | "apply" | "type" | "platform" | "omit";
interface ProfileMutationCallback extends ProfileSessionToken {
	readonly kind: ProfileMutationKind;
	readonly value?: string;
}

async function handleChatShared(
	ctx: Context,
	options: ProfileTelegramFeatureOptions,
	userId: string,
	shared: { request_id: number; chat_id: number | string; title?: string; username?: string },
): Promise<void> {
	const session = await activeSession(options, userId);
	if (session === undefined || session.state.step !== "platform" || session.state.requestId !== shared.request_id) {
		await ctx.reply("Эта кнопка выбора канала уже неактуальна. Вернитесь к профилю и выберите канал ещё раз.");
		return;
	}
	if (shared.username === undefined) {
		const saved = await saveState(options, userId, withoutRequestId({
			...session.state,
			step: "platform_url",
			draft: { ...session.state.draft, platform: { platformType: "telegram", url: "https://t.me/manual" }, audienceAutofill: "allow" },
		}));
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
		await finishQuickApplicationProfile(ctx, options, userId, withoutRequestId({
			...session.state,
			draft: { ...session.state.draft, platform, audienceAutofill: "allow" },
		}));
		return;
	}
	const saved = await saveState(options, userId, withoutRequestId({
		version: PROFILE_SESSION_VERSION,
		generation: session.state.generation,
		step: "audience",
		draft: { ...session.state.draft, platform, audienceAutofill: "allow" },
	}));
	await renderStep(ctx, options, userId, saved);
}

async function advanceText(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, session: ProfileSessionRecord, text: string): Promise<void> {
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
			await choosePlatform(ctx, options, userId, value, requestIdFactory(options));
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
			await saveState(options, userId, { ...state, step: "review", draft: { ...state.draft, platform: { ...platform, audienceSize: Number(value) }, audienceAutofill: "suppress" } });
			await renderReview(ctx, options, userId);
			return;
		}
		case "review":
			await ctx.reply("Проверьте данные и сохраните профиль либо отмените заполнение.", { reply_markup: reviewKeyboard(session) });
			return;
		case "application_message":
			if (!isApplicationSession(session)) {
				await ctx.reply("Сохранённое заполнение повреждено. Начните отклик заново.", { reply_markup: options.menuKeyboard() });
				return;
			}
			await submitApplicationMessage(ctx, options, userId, session, value);
	}
}

async function omitOptional(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, expected: ProfileSessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	await omitOptionalFromSession(ctx, options, userId, session);
}

async function omitOptionalFromSession(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, session: ProfileSessionRecord): Promise<void> {
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
			saved = await saveState(options, userId, {
				...state,
				step: "review",
				draft: {
					...state.draft,
					platform: withoutAudience(platform),
					audienceAutofill: platform.audienceSize === undefined ? "allow" : "suppress",
				},
			});
			break;
		}
		default:
			await ctx.reply("Эту часть профиля нельзя пропустить. Продолжите с текущего шага.", { reply_markup: resumeKeyboard(session) });
			return;
	}
	await renderStep(ctx, options, userId, saved);
}

async function cancelCurrentSession(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	await options.sessionRepository.delete(userId);
	await ctx.reply(
		isApplicationSession(session) ? "Отклик отменён. Сохранённый профиль не изменён." : "Заполнение профиля отменено.",
		{ reply_markup: options.menuKeyboard() },
	);
}

async function cancelSession(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, expected: ProfileSessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	await options.sessionRepository.delete(userId);
	await ctx.reply(
		isApplicationSession(session) ? "Отклик отменён. Сохранённый профиль не изменён." : "Заполнение профиля отменено.",
		{ reply_markup: options.menuKeyboard() },
	);
}

async function backSession(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, expected: ProfileSessionToken): Promise<void> {
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
				draft: { description: null, topics: [], audienceAutofill: "allow" },
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
			await ctx.reply("Короткое заполнение отменено.", { reply_markup: options.menuKeyboard() });
			return;
		case "application_message":
			await options.sessionRepository.delete(userId);
			await options.reopenApplicationCard(ctx, userId, state.continuation.collaborationId);
			return;
		default:
			await ctx.reply("Продолжите с текущего шага.", { reply_markup: applicationNavigationKeyboard(session) });
	}
}

async function chooseType(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, raw: string, expected?: ProfileSessionToken): Promise<void> {
	let type: ProfileType;
	const session = expected === undefined ? await activeSession(options, userId) : await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	try {
		type = PROFILE_TYPE_INPUTS.get(raw.trim().toLowerCase()) ?? parseProfileType(raw);
	} catch {
		await ctx.reply("Выберите один из предложенных вариантов.", { reply_markup: typeKeyboard(session) });
		return;
	}
	const saved = await saveState(options, userId, withoutRequestId({
		version: PROFILE_SESSION_VERSION,
		generation: session.state.generation,
		step: "display_name",
		draft: { ...session.state.draft, type },
		...(session.state.continuation === undefined ? {} : { continuation: session.state.continuation }),
	}));
	await renderStep(ctx, options, userId, saved);
}

async function choosePlatform(
	ctx: Context,
	options: ProfileTelegramFeatureOptions,
	userId: string,
	raw: string,
	createRequestId: () => number,
	expected?: ProfileSessionToken,
): Promise<void> {
	let platformType: PlatformType;
	const session = expected === undefined ? await activeSession(options, userId) : await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) {
		await ctx.reply("Не удалось найти сохранённое заполнение. Откройте «👤 Мой профиль» и начните заново.");
		return;
	}
	if (raw === "self") {
		const username = ctx.from?.username === undefined ? undefined : normalizeTelegramUsername(ctx.from.username);
		if (username === undefined) {
			await ctx.reply("Telegram не передал публичного @username. Выберите Telegram-канал или укажите другую публичную ссылку.", { reply_markup: platformKeyboard(session) });
			return;
		}
		const platform = { platformType: "telegram" as const, url: `https://t.me/${username}`, username };
		if (isApplicationState(session.state)) {
			await finishQuickApplicationProfile(ctx, options, userId, withoutRequestId({
				...session.state,
				draft: { ...session.state.draft, platform, audienceAutofill: "allow" },
			}));
			return;
		}
		const saved = await saveState(options, userId, withoutRequestId({
			...session.state,
			step: "audience",
			draft: { ...session.state.draft, platform, audienceAutofill: "allow" },
		}));
		await renderStep(ctx, options, userId, saved);
		return;
	}
	try {
		platformType = parsePlatformType(raw);
	} catch {
		await ctx.reply(PROFILE_LINK_CHOICE_HINT, { reply_markup: platformKeyboard(session, ctx.from?.username) });
		return;
	}
	if (platformType === "telegram") {
		const requestId = uniqueRequestId(createRequestId(), session.state.requestId);
		await saveState(options, userId, { ...session.state, step: "platform", requestId });
		const keyboard = new Keyboard()
			.requestChat("Выбрать Telegram-канал", requestId, { chat_is_channel: true, request_title: true, request_username: true }).row()
			.text("Указать другую ссылку");
		if (isApplicationState(session.state)) keyboard.row().text("← Назад").text("/cancel");
		keyboard.resized();
		await ctx.reply(PROFILE_LINK_CHOICE_HINT, { reply_markup: keyboard });
		return;
	}
	const saved = await saveState(options, userId, withoutRequestId({ ...session.state, step: "platform_url", draft: withoutPlatform(session.state.draft) }));
	await ctx.reply("Укажите другую публичную ссылку в формате https://...", { reply_markup: cancelKeyboard(saved) });
}

async function acceptPlatformUrl(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, state: ProfileSessionState, value: string): Promise<void> {
	if (!isAbsoluteHttps(value)) {
		await ctx.reply("Нужна абсолютная ссылка https://...");
		return;
	}
	const username = telegramUsernameFromUrl(value);
	if (isTelegramHost(value) && username === undefined) {
		await ctx.reply("Нужна публичная ссылка вида https://t.me/channel_name. Приглашения в закрытые каналы не подходят.");
		return;
	}
	const platform = username === undefined
		? { platformType: "other" as const, url: value }
		: { platformType: "telegram" as const, url: `https://t.me/${username}`, username };
	if (isApplicationState(state)) {
		await finishQuickApplicationProfile(ctx, options, userId, withoutRequestId({ ...state, draft: { ...state.draft, platform, audienceAutofill: "allow" } }));
		return;
	}
	const saved = await saveState(options, userId, withoutRequestId({ ...state, step: "audience", draft: { ...state.draft, platform, audienceAutofill: "allow" } }));
	await renderStep(ctx, options, userId, saved);
}

async function apply(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, expected: ProfileSessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	const input = toProfileInput(session.state.draft);
	if (input === undefined) {
		await ctx.reply("Не все поля заполнены. Продолжите заполнение.", { reply_markup: resumeKeyboard(session) });
		return;
	}
	let savedProfile: ProfileRecord;
	try {
		const existing = await options.profileService.getOwn(userId);
		savedProfile = existing === undefined
			? await options.profileService.create(userId, input)
			: await options.profileService.update(userId, input);
	} catch (error) {
		if (error instanceof Error && error.name === "DomainValidationError") {
			await ctx.reply("Проверьте данные профиля и попробуйте ещё раз.", { reply_markup: resumeKeyboard(session) });
			return;
		}
		throw error;
	}
	const continuation = session.state.continuation;
	await options.sessionRepository.delete(userId);
	if (continuation?.kind === "create_collaboration") {
		const renderContinuation = await options.continueCreateCollaboration(ctx, userId);
		if (renderContinuation !== undefined) {
			await ctx.reply("Профиль сохранён. Продолжим создание коллаборации.");
			options.scheduleProfileAudience(ctx, savedProfile, session.state.draft);
			await renderContinuation();
			return;
		}
	}
	await ctx.reply("Готово — профиль сохранён.", { reply_markup: options.menuKeyboard() });
	options.scheduleProfileAudience(ctx, savedProfile, session.state.draft);
}

async function showProfile(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string): Promise<void> {
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

async function startOrResume(
	ctx: Context,
	options: ProfileTelegramFeatureOptions,
	userId: string,
	edit: boolean,
	continuation?: ProfileSessionState["continuation"],
): Promise<void> {
	if (await options.isCollaborationActive(userId)) {
		await ctx.reply("Сначала завершите или отмените заполнение коллаборации.", { reply_markup: options.menuKeyboard() });
		return;
	}
	const current = await activeSession(options, userId);
	if (current !== undefined) {
		await renderStep(ctx, options, userId, current);
		return;
	}
	if (!edit && await options.profileService.getOwn(userId) !== undefined) {
		await ctx.reply("Профиль уже создан. При необходимости обновите его.", { reply_markup: new InlineKeyboard().text("✏️ Изменить профиль", "profile:edit") });
		return;
	}
	const profile = edit ? await options.profileService.getOwn(userId) : undefined;
	const firstPlatform = profile?.platforms[0];
	const draft: ProfileDraft = profile === undefined ? { audienceAutofill: "allow" } : {
		type: profile.type,
		displayName: profile.displayName,
		description: profile.description,
		topics: profile.topics,
		audienceAutofill: "allow",
		...(firstPlatform === undefined ? {} : { platform: firstPlatform }),
	};
	const saved = await saveState(options, userId, {
		version: PROFILE_SESSION_VERSION,
		generation: createSessionGeneration(),
		step: "type",
		draft,
		...(continuation === undefined ? {} : { continuation }),
	});
	await ctx.reply(edit ? "Начнём обновление профиля. Выберите, кто вы:" : "Давайте создадим профиль. Выберите, кто вы:", { reply_markup: typeKeyboard(saved) });
}

async function resume(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	if (session === undefined) {
		await startOrResume(ctx, options, userId, false);
		return;
	}
	await renderStep(ctx, options, userId, session);
}

async function finishQuickApplicationProfile(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, state: ApplicationProfileState): Promise<void> {
	const input = toProfileInput(state.draft);
	if (input === undefined) {
		const current = await activeSession(options, userId);
		await ctx.reply("Не все обязательные данные профиля заполнены.", current === undefined ? undefined : { reply_markup: resumeKeyboard(current) });
		return;
	}
	let createdProfile: ProfileRecord | undefined;
	try {
		if (await options.profileService.getOwn(userId) === undefined) createdProfile = await options.profileService.create(userId, input);
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
		await ctx.reply("Профиль сохранён, но отклик сейчас недоступен.", { reply_markup: options.menuKeyboard() });
		if (createdProfile !== undefined) options.scheduleProfileAudience(ctx, createdProfile, state.draft);
		return;
	}
	const eligibility = await applicationService.checkEligibility({
		telegramUserId: userId,
		collaborationId: state.continuation.collaborationId,
		occurredAt: options.occurredAt(ctx),
	});
	if (!eligibility.ok) {
		await options.sessionRepository.delete(userId);
		await options.replyApplicationFailure(ctx, eligibility.code, undefined, true);
		if (createdProfile !== undefined) options.scheduleProfileAudience(ctx, createdProfile, state.draft);
		return;
	}
	const saved = await saveState(options, userId, { ...state, step: "application_message", draft: state.draft });
	await ctx.reply("Профиль сохранён. Теперь добавьте сообщение автору коллаборации.");
	if (createdProfile !== undefined) options.scheduleProfileAudience(ctx, createdProfile, state.draft);
	await renderStep(ctx, options, userId, saved);
}

async function submitApplicationMessage(
	ctx: Context,
	options: ProfileTelegramFeatureOptions,
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
		occurredAt: options.occurredAt(ctx),
	});
	if (result.ok) {
		await options.sessionRepository.delete(userId);
		await ctx.reply("Отклик отправлен автору коллаборации.", { reply_markup: options.menuKeyboard() });
		return;
	}
	if (result.code !== "invalid_message") await options.sessionRepository.delete(userId);
	await options.replyApplicationFailure(ctx, result.code, result.code === "invalid_message" ? session : undefined);
}

async function renderStep(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string, session: ProfileSessionRecord): Promise<void> {
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

async function renderReview(ctx: Context, options: ProfileTelegramFeatureOptions, userId: string): Promise<void> {
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

async function activeSession(options: ProfileTelegramFeatureOptions, userId: string): Promise<ProfileSessionRecord | undefined> {
	return options.sessionRepository.findActive(userId, now(options.clock));
}

async function sessionAtRevision(
	ctx: Context,
	options: ProfileTelegramFeatureOptions,
	userId: string,
	expected: ProfileSessionToken,
): Promise<ProfileSessionRecord | undefined> {
	const session = await activeSession(options, userId);
	if (session === undefined || session.revision !== expected.revision || session.state.generation !== expected.generation) {
		await ctx.reply("Эта кнопка уже неактуальна. Откройте «👤 Мой профиль» и продолжите с текущего шага.");
		return undefined;
	}
	return session;
}

async function saveState(options: ProfileTelegramFeatureOptions, userId: string, state: ProfileSessionState): Promise<ProfileSessionRecord> {
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
	} catch {
		return undefined;
	}
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

function requestIdFactory(options: ProfileTelegramFeatureOptions): () => number {
	return options.requestIdFactory ?? (() => randomInt(1, 2_147_483_647));
}

function createSessionGeneration(): string {
	return randomBytes(8).toString("hex");
}

function sessionToken(session: ProfileSessionRecord): ProfileSessionToken {
	return { generation: session.state.generation, revision: session.revision };
}

function withoutRequestId<T extends ProfileSessionState>(state: T): Omit<T, "requestId"> {
	const without: { -readonly [Key in keyof T]: T[Key] } = { ...state };
	delete without.requestId;
	return without;
}

function withoutPlatform(draft: ProfileDraft): ProfileDraft {
	const without = { ...draft, audienceAutofill: DEFAULT_AUDIENCE_AUTOFILL };
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

function isAbsoluteHttps(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.username === "" && url.password === "";
	} catch {
		return false;
	}
}

function isTelegramHost(value: string): boolean {
	try {
		return new URL(value).hostname.toLowerCase() === "t.me";
	} catch {
		return false;
	}
}

function telegramUsernameFromUrl(value: string): string | undefined {
	if (!isAbsoluteHttps(value)) return undefined;
	try {
		const url = new URL(value);
		if (url.hostname.toLowerCase() !== "t.me") return undefined;
		return normalizeTelegramUsername(url.pathname.slice(1).replace(/\/$/, ""));
	} catch {
		return undefined;
	}
}

function uniqueRequestId(candidate: number, previous: number | undefined): number {
	return Number.isSafeInteger(candidate) && candidate >= -2_147_483_648 && candidate <= 2_147_483_647 && candidate !== previous
		? candidate
		: previous === 2_147_483_647 ? 1 : 2_147_483_647;
}

function now(clock: Clock): number {
	return clock.now().getTime();
}
