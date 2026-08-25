export interface TelegramUserSnapshot {
	readonly telegramUserId: string;
	readonly username?: string;
	readonly displayName: string;
	readonly updatedAt: number;
}

export interface TelegramUserWriter {
	upsert(snapshot: TelegramUserSnapshot): Promise<void>;
}
