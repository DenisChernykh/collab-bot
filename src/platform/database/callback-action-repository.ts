import type {
	CallbackActionRecord,
	CallbackActionStore,
} from "../../shared/application/ports/callback-action-store.js";
import { CallbackActionStoreCorruptError as CorruptError } from "../../shared/application/ports/callback-action-store.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "./node-sql-database.js";
import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";

interface ActionRow {
	token_hash?: unknown;
	actor_telegram_user_id?: unknown;
	action_type?: unknown;
	entity_id?: unknown;
	expected_version?: unknown;
	mode?: unknown;
	expires_at?: unknown;
	consumed_at?: unknown;
	result_json?: unknown;
}

export class SqliteCallbackActionRepository implements CallbackActionStore {
	private readonly boundary: SqlDatabase;

	constructor(source: SqlDatabaseInput) {
		this.boundary = resolveSqlDatabase(source);
	}

	async findByTokenHash(tokenHash: string): Promise<CallbackActionRecord | undefined> {
		const rows = await this.boundary.query<ActionRow>(
			"SELECT token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json FROM telegram_actions WHERE token_hash = ?",
			[tokenHash],
		);
		const row = rows[0];
		if (row === undefined) {
			return undefined;
		}
		if (!isValidActionRow(row, tokenHash)) {
			throw new CorruptError();
		}
		return {
			tokenHash: row.token_hash as string,
			actorTelegramUserId: row.actor_telegram_user_id as string,
			actionType: row.action_type as string,
			entityId: row.entity_id as string | null,
			expectedVersion: row.expected_version as number | null,
			mode: row.mode as "one_shot" | "reusable",
			expiresAt: row.expires_at as number,
			consumedAt: row.consumed_at as number | null,
			resultJson: row.result_json as string | null,
		};
	}

	async insert(record: CallbackActionRecord): Promise<void> {
		await this.boundary.execute(
			"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
			[
				record.tokenHash,
				record.actorTelegramUserId,
				record.actionType,
				record.entityId,
				record.expectedVersion,
				record.mode,
				record.expiresAt,
			],
		);
	}

	async consume(tokenHash: string, consumedAt: number, resultJson: string): Promise<void> {
		const result = await this.boundary.execute(
			"UPDATE telegram_actions SET consumed_at = ?, result_json = ? WHERE token_hash = ? AND mode = 'one_shot' AND consumed_at IS NULL",
			[consumedAt, resultJson, tokenHash],
		) as { changes?: number };
		if (result.changes !== 1) {
			throw new CorruptError();
		}
	}

	async deleteExpired(now: number): Promise<number> {
		const result = await this.boundary.execute("DELETE FROM telegram_actions WHERE expires_at <= ?", [now]) as { changes?: number };
		return result.changes ?? 0;
	}
}

function isValidActionRow(row: ActionRow, expectedTokenHash: string): boolean {
	return (
		typeof row.token_hash === "string" && row.token_hash === expectedTokenHash && /^[0-9a-f]{64}$/.test(row.token_hash) &&
		typeof row.actor_telegram_user_id === "string" && /^[0-9]+$/.test(row.actor_telegram_user_id) &&
		typeof row.action_type === "string" && /^[a-z][a-z0-9._-]{0,63}$/.test(row.action_type) &&
		(row.entity_id === null || (typeof row.entity_id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.entity_id))) &&
		(row.expected_version === null || (Number.isSafeInteger(row.expected_version) && (row.expected_version as number) >= 0)) &&
		(row.mode === "one_shot" || row.mode === "reusable") &&
		Number.isSafeInteger(row.expires_at) && (row.expires_at as number) >= 0 &&
		(row.consumed_at === null || (Number.isSafeInteger(row.consumed_at) && (row.consumed_at as number) >= 0)) &&
		(row.result_json === null || (typeof row.result_json === "string" && isJson(row.result_json))) &&
		(row.mode === "one_shot" || row.consumed_at === null) &&
		(row.consumed_at === null || row.result_json !== null)
	);
}

function isJson(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}
