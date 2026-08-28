export type TelegramUserStatus = "active" | "blocked";

export interface TelegramUserRecord {
	readonly telegramUserId: string;
	readonly status: TelegramUserStatus;
}

export interface TelegramUserLookup {
	findByTelegramUserId(telegramUserId: string): Promise<TelegramUserRecord | undefined>;
}
