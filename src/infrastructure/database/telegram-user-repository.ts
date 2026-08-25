import type {
	TelegramUserLookup,
	TelegramUserRecord,
} from "../../application/ports/telegram-user-lookup.js";
import type { DatabaseBoundary } from "./database-boundary.js";

export class SqliteTelegramUserRepository implements TelegramUserLookup {
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
}
