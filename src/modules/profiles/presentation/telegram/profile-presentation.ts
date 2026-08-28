import { InlineKeyboard } from "grammy";

import type {
	ProfileSessionRecord,
	ProfileSessionState,
} from "../../application/ports/profile-session-repository.js";
import type { ProfileType, Topic } from "../../../../shared/domain/value-objects/enums.js";

export const PROFILE_LINK_PROMPT = "Добавьте публичную площадку. Она будет видна другим пользователям до принятия отклика.";
export const PROFILE_LINK_CHOICE_HINT = "Выберите личный Telegram-профиль или Telegram-канал. Для другой публичной площадки нажмите «Указать другую ссылку».";

export const PROFILE_TYPE_LABELS: Record<ProfileType, string> = {
	blogger: "Блогер",
	telegram_channel: "Telegram-канал",
	venue_or_brand: "Заведение или бренд",
};

export const TOPIC_LABELS: Record<Topic, string> = {
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

export type ProfileSessionToken = { readonly generation: string; readonly revision: number };
export type ProfileSessionIdentity = ProfileSessionRecord | ProfileSessionToken;
export type ApplicationContinuation = Extract<NonNullable<ProfileSessionState["continuation"]>, { readonly kind: "submit_application" }>;
export type ApplicationProfileState = ProfileSessionState & { readonly continuation: ApplicationContinuation };
export type ApplicationProfileSession = ProfileSessionRecord & { readonly state: ApplicationProfileState };

export function isApplicationState(state: ProfileSessionState): state is ApplicationProfileState {
	return state.continuation?.kind === "submit_application";
}

export function isApplicationSession(session: ProfileSessionRecord | undefined): session is ApplicationProfileSession {
	return session !== undefined && isApplicationState(session.state);
}

export function profileTypeLabel(type: ProfileType): string {
	return PROFILE_TYPE_LABELS[type];
}

export function topicLabel(topic: Topic): string {
	return TOPIC_LABELS[topic];
}

export function resumeKeyboard(identity: ProfileSessionIdentity): InlineKeyboard {
	const application = "state" in identity && isApplicationState(identity.state);
	return new InlineKeyboard()
		.text(application ? "▶️ Продолжить отклик" : "▶️ Продолжить профиль", "profile:resume").row()
		.text(application ? "Отменить отклик" : "Отменить заполнение", revisionCallback("profile:cancel", identity));
}

export function reviewKeyboard(identity: ProfileSessionIdentity): InlineKeyboard {
	return new InlineKeyboard()
		.text("Сохранить профиль", revisionCallback("profile:apply", identity)).row()
		.text("Отменить заполнение", revisionCallback("profile:cancel", identity));
}

export function cancelKeyboard(identity: ProfileSessionIdentity): InlineKeyboard {
	return "state" in identity && isApplicationState(identity.state)
		? applicationNavigationKeyboard(identity)
		: new InlineKeyboard().text("Отменить заполнение", revisionCallback("profile:cancel", identity));
}

export function optionalKeyboard(identity: ProfileSessionIdentity, populated: boolean): InlineKeyboard {
	return new InlineKeyboard()
		.text(populated ? "Очистить" : "Пропустить", revisionCallback("profile:omit", identity)).row()
		.text("Отменить заполнение", revisionCallback("profile:cancel", identity));
}

export function typeKeyboard(identity: ProfileSessionIdentity): InlineKeyboard {
	const keyboard = new InlineKeyboard()
		.text("Блогер", revisionCallback("profile:type:blogger", identity)).row()
		.text("Telegram-канал", revisionCallback("profile:type:telegram_channel", identity)).row()
		.text("Заведение или бренд", revisionCallback("profile:type:venue_or_brand", identity));
	if ("state" in identity && isApplicationState(identity.state)) {
		keyboard.row().text("← Назад", revisionCallback("profile:back", identity)).row().text("Отменить", revisionCallback("profile:cancel", identity));
	}
	return keyboard;
}

export function platformKeyboard(identity: ProfileSessionIdentity, currentUsername?: string): InlineKeyboard {
	const username = currentUsername === undefined ? undefined : normalizeTelegramUsername(currentUsername);
	const keyboard = new InlineKeyboard();
	if (username !== undefined) keyboard.text(`Использовать @${username}`, revisionCallback("profile:platform:self", identity)).row();
	keyboard
		.text("Выбрать Telegram-канал", revisionCallback("profile:platform:telegram", identity)).row()
		.text("Указать другую ссылку", revisionCallback("profile:platform:other", identity));
	if ("state" in identity && isApplicationState(identity.state)) {
		keyboard.row().text("← Назад", revisionCallback("profile:back", identity)).row().text("Отменить", revisionCallback("profile:cancel", identity));
	}
	return keyboard;
}

export function applicationNavigationKeyboard(identity: ProfileSessionIdentity): InlineKeyboard {
	return new InlineKeyboard()
		.text("← Назад", revisionCallback("profile:back", identity)).row()
		.text("Отменить", revisionCallback("profile:cancel", identity));
}

export function normalizeTelegramUsername(value: string): string | undefined {
	const normalized = value.trim().replace(/^@+/, "");
	return /^[A-Za-z0-9_]{5,32}$/.test(normalized) ? normalized : undefined;
}

function revisionCallback(action: string, identity: ProfileSessionIdentity): string {
	const normalized = "state" in identity ? { generation: identity.state.generation, revision: identity.revision } : identity;
	return `${action}:g${normalized.generation}:r${normalized.revision}`;
}
