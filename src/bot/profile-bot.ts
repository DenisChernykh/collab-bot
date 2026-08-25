import { randomBytes, randomInt } from "node:crypto";

import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { Update } from "grammy/types";

import type { Clock } from "../application/ports/clock.js";
import type { CanonicalInput } from "../application/commands/canonical-input.js";
import type { DurableCommandExecutor } from "../application/commands/command-executor.js";
import type {
	ProfileSessionRepository,
	ProfileSessionRecord,
	ProfileSessionState,
	ProfileDraft,
} from "../application/ports/profile-session-repository.js";
import { PROFILE_SESSION_TTL_MS, PROFILE_SESSION_VERSION } from "../application/ports/profile-session-repository.js";
import type { TelegramUserWriter } from "../application/ports/telegram-user-writer.js";
import { ProfileService } from "../application/profiles/profile-service.js";
import type { ProfileInput } from "../domain/profiles/profile.js";
import { parsePlatformType, parseProfileType, parseTopic, type PlatformType, type ProfileType, type Topic } from "../domain/value-objects/enums.js";

const PROFILE_STATIC_CALLBACKS = new Set(["menu:home", "profile:create", "profile:resume", "profile:view", "profile:edit", "profile:unavailable"]);
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
type ProfileMutationKind = "cancel" | "apply" | "type" | "platform";
interface ProfileMutationCallback {
	readonly kind: ProfileMutationKind;
	readonly value?: string;
	readonly generation: string;
	readonly revision: number;
}
type SessionToken = { readonly generation: string; readonly revision: number };
type SessionIdentity = ProfileSessionRecord | SessionToken;

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
			if (!PROFILE_STATIC_CALLBACKS.has(data) && mutation === undefined) return;
			const userId = String(workCtx.from.id);
			if (mutation !== undefined) {
				switch (mutation.kind) {
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
				}
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
				await workCtx.reply("Этот раздел пока готовится. Сейчас вы можете создать и отредактировать профиль.", { reply_markup: menuKeyboard() });
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
		await renderMenu(ctx, options, userId);
		return;
	}
	if (command === "/help") {
		await ctx.reply(`«Вместе в Екатеринбурге» помогает блогерам, Telegram-каналам, заведениям и брендам находить партнёров для совместных проектов.\n\nСейчас вы можете создать и отредактировать свой профиль. По вопросам работы бота: ${options.helpContact}`);
		return;
	}
	if (command === "/cancel") {
		await options.sessionRepository.delete(userId);
		await ctx.reply("Заполнение профиля отменено.", { reply_markup: menuKeyboard() });
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
		await ctx.reply("Не удалось распознать команду. Откройте главное меню командой /start или воспользуйтесь /help.", { reply_markup: menuKeyboard() });
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
		else if (await options.profileService.getOwn(String(from.id)) !== undefined) await ctx.reply("Запрос уже обработан. Профиль уже сохранён.", { reply_markup: menuKeyboard() });
		else await ctx.reply("Запрос уже обработан.", { reply_markup: menuKeyboard() });
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
	const saved = await saveState(options, userId, withoutRequestId({ version: PROFILE_SESSION_VERSION, generation: session.state.generation, step: "audience", draft: { ...session.state.draft, platform } }));
	await ctx.reply("Укажите размер аудитории числом или отправьте `-`, если не хотите указывать.", { reply_markup: cancelKeyboard(saved) });
}

async function advanceText(ctx: Context, options: ProfileBotOptions, userId: string, session: ProfileSessionRecord, text: string): Promise<void> {
	const state = session.state;
	const value = text.trim();
	switch (state.step) {
		case "type":
			await chooseType(ctx, options, userId, value);
			return;
		case "display_name": {
			if (value.length < 2 || value.length > 100) {
				await ctx.reply("Название должно быть длиной от 2 до 100 символов.");
				return;
			}
			const saved = await saveState(options, userId, { ...state, step: "topics", draft: { ...state.draft, displayName: value } });
			await ctx.reply("Укажите от 1 до 3 тем через запятую: Lifestyle, Еда и рестораны, Красота, Путешествия, Город, События, Семья, Спорт, Бизнес, Другое.", { reply_markup: cancelKeyboard(saved) });
			return;
		}
		case "topics": {
			const topics = parseTopics(value);
			if (topics === undefined) {
				await ctx.reply("Выберите от 1 до 3 разных тем из предложенного списка.");
				return;
			}
			const saved = await saveState(options, userId, { ...state, step: "description", draft: { ...state.draft, topics } });
			await ctx.reply("Опишите профиль (10–500 символов).", { reply_markup: cancelKeyboard(saved) });
			return;
		}
		case "description": {
			if (value.length < 10 || value.length > 500) {
				await ctx.reply("Описание должно быть длиной от 10 до 500 символов.");
				return;
			}
			const saved = await saveState(options, userId, { ...state, step: "platform", draft: { ...state.draft, description: value } });
			await ctx.reply("Выберите основную площадку.", { reply_markup: platformKeyboard(saved) });
			return;
		}
		case "platform":
			if (value === "Ввести ссылку вручную" || value.toLowerCase() === "manual") {
				const saved = await saveState(options, userId, { ...state, step: "platform_url", draft: { ...state.draft, platform: { platformType: "telegram", url: "https://t.me/manual" } } });
				await ctx.reply("Отправьте публичную ссылку вида https://t.me/channel_name.", { reply_markup: cancelKeyboard(saved) });
				return;
			}
			await choosePlatform(ctx, options, userId, value, options.requestIdFactory ?? (() => randomInt(1, 2_147_483_647)));
			return;
		case "platform_url":
			await acceptPlatformUrl(ctx, options, userId, state, value);
			return;
		case "audience": {
			if (value !== "-" && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
				await ctx.reply("Размер аудитории должен быть неотрицательным числом или `-`.");
				return;
			}
			const platform = state.draft.platform;
			if (platform === undefined) {
				await ctx.reply("Площадка не выбрана. Начните заполнение заново.");
				return;
			}
			const withAudience = value === "-" ? platform : { ...platform, audienceSize: Number(value) };
			const saved = await saveState(options, userId, { ...state, step: "private_contact", draft: { ...state.draft, platform: withAudience } });
			await ctx.reply("Укажите контакт для связи (3–200 символов). Другие пользователи увидят его только после того, как вы примете их отклик.", { reply_markup: cancelKeyboard(saved) });
			return;
		}
		case "private_contact":
			if (value.length < 3 || value.length > 200 || value.includes("\u0000")) {
				await ctx.reply("Контакт должен быть длиной от 3 до 200 символов.");
				return;
			}
			await saveState(options, userId, { ...state, step: "review", draft: { ...state.draft, privateContact: value } });
			await renderReview(ctx, options, userId);
			return;
		case "review":
			await ctx.reply("Проверьте данные и сохраните профиль либо отмените заполнение.", { reply_markup: reviewKeyboard(session) });
			return;
	}
}

async function cancelSession(ctx: Context, options: ProfileBotOptions, userId: string, expected: SessionToken): Promise<void> {
	const session = await sessionAtRevision(ctx, options, userId, expected);
	if (session === undefined) return;
	await options.sessionRepository.delete(userId);
	await ctx.reply("Заполнение профиля отменено.", { reply_markup: menuKeyboard() });
}

async function chooseType(ctx: Context, options: ProfileBotOptions, userId: string, raw: string, expected?: SessionToken): Promise<void> {
		let type: ProfileType;
		const session = expected === undefined ? await activeSession(options, userId) : await sessionAtRevision(ctx, options, userId, expected);
		if (session === undefined) return;
		try { type = PROFILE_TYPE_INPUTS.get(raw.trim().toLowerCase()) ?? parseProfileType(raw); } catch { await ctx.reply("Выберите один из предложенных вариантов.", { reply_markup: typeKeyboard(session) }); return; }
		const draft = session?.state.draft ?? {};
		const saved = await saveState(options, userId, withoutRequestId({ version: PROFILE_SESSION_VERSION, generation: session.state.generation, step: "display_name", draft: { ...draft, type } }));
		await ctx.reply("Как назвать ваш профиль? Это может быть ваше имя, название канала, заведения или бренда (2–100 символов).", { reply_markup: cancelKeyboard(saved) });
}

async function choosePlatform(ctx: Context, options: ProfileBotOptions, userId: string, raw: string, requestIdFactory: () => number, expected?: SessionToken): Promise<void> {
		let platformType: PlatformType;
		const session = expected === undefined ? await activeSession(options, userId) : await sessionAtRevision(ctx, options, userId, expected);
		if (session === undefined) { await ctx.reply("Не удалось найти сохранённое заполнение. Откройте «👤 Мой профиль» и начните заново."); return; }
		try { platformType = parsePlatformType(raw); } catch { await ctx.reply("Выберите предложенную площадку.", { reply_markup: platformKeyboard(session) }); return; }
		if (platformType === "telegram") {
			const requestId = uniqueRequestId(requestIdFactory(), session.state.requestId);
			await saveState(options, userId, { ...session.state, step: "platform", requestId });
			const keyboard = new Keyboard().requestChat("Выбрать Telegram-канал", requestId, { chat_is_channel: true, request_title: true, request_username: true }).row().text("Ввести ссылку вручную").resized();
			await ctx.reply("Выберите публичный Telegram-канал. Если нужного канала нет в списке, введите ссылку вручную.", { reply_markup: keyboard });
			return;
		}
		const saved = await saveState(options, userId, withoutRequestId({ ...session.state, step: "platform_url", draft: { ...withoutPlatform(session.state.draft), platform: { platformType, url: "https://example.com/manual" } } }));
		await ctx.reply("Пришлите публичную ссылку площадки https://...", { reply_markup: cancelKeyboard(saved) });
}

async function acceptPlatformUrl(ctx: Context, options: ProfileBotOptions, userId: string, state: ProfileSessionState, value: string): Promise<void> {
		const platformType = state.draft.platform?.platformType ?? "telegram";
		if (!isAbsoluteHttps(value)) { await ctx.reply("Нужна абсолютная ссылка https://..."); return; }
		let saved;
		if (platformType === "telegram") {
			const username = telegramUsernameFromUrl(value);
			if (username === undefined) { await ctx.reply("Для Telegram-канала нужна публичная ссылка вида https://t.me/channel_name."); return; }
			saved = await saveState(options, userId, withoutRequestId({ ...state, step: "audience", draft: { ...state.draft, platform: { platformType: "telegram", url: `https://t.me/${username}`, username } } }));
		} else {
			saved = await saveState(options, userId, withoutRequestId({ ...state, step: "audience", draft: { ...state.draft, platform: { platformType, url: value } } }));
		}
		await ctx.reply("Укажите размер аудитории числом или отправьте `-`.", { reply_markup: cancelKeyboard(saved) });
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
	await options.sessionRepository.delete(userId);
	await ctx.reply("Готово — профиль сохранён.", { reply_markup: menuKeyboard() });
}

async function showProfile(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const profile = await options.profileService.getOwn(userId);
	if (profile === undefined) {
		await ctx.reply("У вас пока нет профиля. Создайте его, чтобы представиться будущим партнёрам.", { reply_markup: new InlineKeyboard().text("➕ Создать профиль", "profile:create") });
		return;
	}
	const topics = profile.topics.map(topicLabel).join(", ");
	const platform = profile.platforms[0];
	await ctx.reply(`Ваш профиль\n\nНазвание: ${profile.displayName}\nКто вы: ${profileTypeLabel(profile.type)}\nТемы: ${topics}\nПлощадка: ${platform?.url ?? "не указана"}\nКонтакт для связи: ${profile.privateContact}`, { reply_markup: new InlineKeyboard().text("✏️ Изменить профиль", "profile:edit").row().text("← В главное меню", "menu:home") });
}

async function startOrResume(ctx: Context, options: ProfileBotOptions, userId: string, edit: boolean): Promise<void> {
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
		privateContact: profile.privateContact,
	};
	const saved = await saveState(options, userId, { version: PROFILE_SESSION_VERSION, generation: createSessionGeneration(), step: "type", draft });
	await ctx.reply(edit ? "Начнём обновление профиля. Выберите, кто вы:" : "Давайте создадим профиль. Выберите, кто вы:", { reply_markup: typeKeyboard(saved) });
}

async function resume(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	if (session === undefined) { await startOrResume(ctx, options, userId, false); return; }
	await renderStep(ctx, options, userId, session);
}

async function renderMenu(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	const keyboard = menuKeyboard();
	if (session !== undefined) keyboard.row().text("▶️ Продолжить профиль", "profile:resume");
	await ctx.reply("Добро пожаловать во «Вместе в Екатеринбурге» — сервис для поиска партнёров и совместных проектов.\n\nВыберите, что хотите сделать:", { reply_markup: keyboard });
}

	async function renderStep(ctx: Context, options: ProfileBotOptions, userId: string, session: ProfileSessionRecord): Promise<void> {
	const state = session.state;
	switch (state.step) {
		case "type": await ctx.reply("Выберите, кто вы:", { reply_markup: typeKeyboard(session) }); return;
		case "display_name": await ctx.reply("Как назвать ваш профиль? Это может быть ваше имя, название канала, заведения или бренда (2–100 символов).", { reply_markup: cancelKeyboard(session) }); return;
		case "topics": await ctx.reply("Укажите от 1 до 3 тем через запятую: Lifestyle, Еда и рестораны, Красота, Путешествия, Город, События, Семья, Спорт, Бизнес, Другое.", { reply_markup: cancelKeyboard(session) }); return;
		case "description": await ctx.reply("Опишите профиль (10–500 символов).", { reply_markup: cancelKeyboard(session) }); return;
		case "platform": await ctx.reply("Выберите основную площадку.", { reply_markup: platformKeyboard(session) }); return;
		case "platform_url": await ctx.reply("Пришлите публичную ссылку площадки https://...", { reply_markup: cancelKeyboard(session) }); return;
		case "audience": await ctx.reply("Укажите размер аудитории числом или отправьте `-`.", { reply_markup: cancelKeyboard(session) }); return;
		case "private_contact": await ctx.reply("Укажите контакт для связи (3–200 символов). Другие пользователи увидят его только после принятого отклика.", { reply_markup: cancelKeyboard(session) }); return;
		case "review": await renderReview(ctx, options, userId); return;
	}
}

async function renderReview(ctx: Context, options: ProfileBotOptions, userId: string): Promise<void> {
	const session = await activeSession(options, userId);
	if (session === undefined) return;
	const draft = session.state.draft;
	await ctx.reply(`Проверьте профиль\n\nНазвание: ${draft.displayName ?? "—"}\nКто вы: ${draft.type === undefined ? "—" : profileTypeLabel(draft.type)}\nОписание: ${draft.description ?? "—"}\nТемы: ${draft.topics?.map(topicLabel).join(", ") ?? "—"}\nПлощадка: ${draft.platform?.url ?? "—"}\nКонтакт для связи: ${draft.privateContact ?? "—"}`, { reply_markup: reviewKeyboard(session) });
}

async function ensureActor(ctx: Context, options: ProfileBotOptions): Promise<boolean> {
	if (ctx.from === undefined) return false;
	const id = String(ctx.from.id);
	const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim() || "Telegram user";
	await options.telegramUserRepository.upsert({ telegramUserId: id, ...(ctx.from.username === undefined ? {} : { username: ctx.from.username }), displayName, updatedAt: now(options.clock) });
	const record = await options.telegramUserRepository.findByTelegramUserId(id);
	return record?.status === "active";
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
	if (draft.type === undefined || draft.displayName === undefined || draft.description === undefined || draft.topics === undefined || draft.platform === undefined || draft.privateContact === undefined) return undefined;
	return { type: draft.type, displayName: draft.displayName, description: draft.description, topics: draft.topics, platforms: [draft.platform], privateContact: draft.privateContact };
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
	const match = /^(profile:(?:cancel|apply)|profile:(?:type|platform):([a-z_]+)):g([a-f0-9]{16}):r(\d+)$/.exec(data);
	if (match === null) return undefined;
	const [, action, value, generation, revisionRaw] = match;
	if (action === undefined || generation === undefined || revisionRaw === undefined) return undefined;
	const revision = Number(revisionRaw);
	if (!Number.isSafeInteger(revision) || revision < 0) return undefined;
	if (action === "profile:cancel") return { kind: "cancel", generation, revision };
	if (action === "profile:apply") return { kind: "apply", generation, revision };
	if (action.startsWith("profile:type:")) return { kind: "type", value: value ?? action.slice("profile:type:".length), generation, revision };
	if (action.startsWith("profile:platform:")) return { kind: "platform", value: value ?? action.slice("profile:platform:".length), generation, revision };
	return undefined;
}
function withoutRequestId(state: Omit<ProfileSessionState, "requestId"> & { requestId?: number }): ProfileSessionState {
	const without = { ...state };
	delete without.requestId;
	return without;
}
function withoutPlatform(draft: ProfileDraft): ProfileDraft {
	const without = { ...draft };
	delete without.platform;
	return without;
}

function menuKeyboard(): InlineKeyboard { return new InlineKeyboard().text("➕ Создать коллаборацию", "profile:unavailable").row().text("🔎 Найти коллаборацию", "profile:unavailable").row().text("📋 Мои коллаборации", "profile:unavailable").row().text("💬 Мои отклики", "profile:unavailable").row().text("👤 Мой профиль", "profile:view"); }
function createSessionGeneration(): string { return randomBytes(8).toString("hex"); }
function revisionCallback(action: string, identity: SessionIdentity): string {
	const normalized = "state" in identity ? { generation: identity.state.generation, revision: identity.revision } : identity;
	return `${action}:g${normalized.generation}:r${normalized.revision}`;
}
function resumeKeyboard(identity: SessionIdentity): InlineKeyboard { return new InlineKeyboard().text("▶️ Продолжить профиль", "profile:resume").row().text("Отменить заполнение", revisionCallback("profile:cancel", identity)); }
function reviewKeyboard(identity: SessionIdentity): InlineKeyboard { return new InlineKeyboard().text("Сохранить профиль", revisionCallback("profile:apply", identity)).row().text("Отменить заполнение", revisionCallback("profile:cancel", identity)); }
function cancelKeyboard(identity: SessionIdentity): InlineKeyboard { return new InlineKeyboard().text("Отменить заполнение", revisionCallback("profile:cancel", identity)); }
function typeKeyboard(identity: SessionIdentity): InlineKeyboard { return new InlineKeyboard().text("Блогер", revisionCallback("profile:type:blogger", identity)).row().text("Telegram-канал", revisionCallback("profile:type:telegram_channel", identity)).row().text("Заведение или бренд", revisionCallback("profile:type:venue_or_brand", identity)); }
function platformKeyboard(identity: SessionIdentity): InlineKeyboard { return new InlineKeyboard().text("Telegram-канал", revisionCallback("profile:platform:telegram", identity)).row().text("Сайт", revisionCallback("profile:platform:website", identity)); }
