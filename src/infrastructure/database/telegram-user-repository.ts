import type {
	TelegramUserLookup,
	TelegramUserRecord,
} from "../../shared/application/ports/telegram-user-lookup.js";
import type { TelegramUserSnapshot, TelegramUserWriter } from "../../shared/application/ports/telegram-user-writer.js";
import type { DatabaseBoundary } from "./database-boundary.js";

export class SqliteTelegramUserRepository implements TelegramUserLookup, TelegramUserWriter {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findByTelegramUserId(telegramUserId: string): Promise<TelegramUserRecord | undefined> {
		const rows = await this.boundary.query<{ telegram_user_id?: unknown; status?: unknown }>(
			"SELECT telegram_user_id, status FROM telegram_users WHERE telegram_user_id = ?",
			[telegramUserId],
		);
		const row = rows[0];
		if (row?.telegram_user_id === undefined || (row.status !== "active" && row.status !== "blocked")) {
			return undefined;
		}
		return {
			telegramUserId: row.telegram_user_id as string,
			status: row.status,
		};
	}

	async upsert(snapshot: TelegramUserSnapshot): Promise<void> {
		await this.boundary.execute(
			`INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at)
			 VALUES (?, ?, ?, 'active', NULL, ?, ?)
			 ON CONFLICT(telegram_user_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, updated_at = excluded.updated_at`,
			[snapshot.telegramUserId, snapshot.username ?? null, snapshot.displayName, snapshot.updatedAt, snapshot.updatedAt],
		);
	}
}
