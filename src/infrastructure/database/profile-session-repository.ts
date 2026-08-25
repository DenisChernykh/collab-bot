import type {
	ProfileSessionRecord,
	ProfileSessionRepository,
	ProfileSessionState,
} from "../../application/ports/profile-session-repository.js";
import type { DatabaseBoundary } from "./database-boundary.js";

interface SessionRow {
	telegram_user_id?: unknown;
	state_json?: unknown;
	revision?: unknown;
	expires_at?: unknown;
	updated_at?: unknown;
}

export class SqliteProfileSessionRepository implements ProfileSessionRepository {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findActive(telegramUserId: string, now: number): Promise<ProfileSessionRecord | undefined> {
		const rows = await this.boundary.query<SessionRow>(
			"SELECT telegram_user_id, state_json, revision, expires_at, updated_at FROM profile_sessions WHERE telegram_user_id = ? AND expires_at > ?",
			[telegramUserId, now],
		);
		const row = rows[0];
		if (row === undefined || !isSessionRow(row, telegramUserId)) {
			return undefined;
		}
		return {
			telegramUserId,
			state: parseState(row.state_json as string),
			revision: row.revision as number,
			expiresAt: row.expires_at as number,
			updatedAt: row.updated_at as number,
		};
	}

	async save(record: ProfileSessionRecord): Promise<void> {
		if (!isSessionRow({
			telegram_user_id: record.telegramUserId,
			state_json: JSON.stringify(record.state),
			revision: record.revision,
			expires_at: record.expiresAt,
			updated_at: record.updatedAt,
		}, record.telegramUserId)) {
			throw new Error("invalid profile session record");
		}
		await this.boundary.withTransaction(async () => {
			const collaborationRows = await this.boundary.query<{ collaboration_id: unknown }>("SELECT collaboration_id FROM collaboration_sessions WHERE telegram_user_id = ? AND expires_at > ?", [record.telegramUserId, record.updatedAt]);
			if (collaborationRows.length > 0) throw new Error("another wizard is already active");
			await this.boundary.execute(
				`INSERT INTO profile_sessions (telegram_user_id, flow_type, step, state_json, revision, expires_at, updated_at)
				 VALUES (?, 'profile', ?, ?, ?, ?, ?)
				 ON CONFLICT(telegram_user_id) DO UPDATE SET flow_type = 'profile', step = excluded.step, state_json = excluded.state_json, revision = excluded.revision, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
				[record.telegramUserId, record.state.step, JSON.stringify(record.state), record.revision, record.expiresAt, record.updatedAt],
			);
		});
	}

	async delete(telegramUserId: string): Promise<void> {
		await this.boundary.execute("DELETE FROM profile_sessions WHERE telegram_user_id = ?", [telegramUserId]);
	}
}

function isSessionRow(row: SessionRow, telegramUserId: string): boolean {
	return typeof row.telegram_user_id === "string" && row.telegram_user_id === telegramUserId &&
		typeof row.state_json === "string" && isJsonObject(row.state_json) &&
		Number.isSafeInteger(row.revision) && (row.revision as number) >= 0 &&
		Number.isSafeInteger(row.expires_at) && (row.expires_at as number) >= 0 &&
		Number.isSafeInteger(row.updated_at) && (row.updated_at as number) >= 0;
}

function parseState(value: string): ProfileSessionState {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("profile session state is corrupt");
	}
	if (!isProfileSessionState(parsed)) {
		throw new Error("profile session state is unsupported");
	}
	return parsed;
}

function isJsonObject(value: string): boolean {
	try {
		const parsed = JSON.parse(value);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
	} catch {
		return false;
	}
}

function isProfileSessionState(value: unknown): value is ProfileSessionState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const steps = new Set(["type", "display_name", "topics", "description", "platform", "platform_url", "audience", "review"]);
	return candidate.version === 1 && typeof candidate.generation === "string" && /^[a-f0-9]{16}$/.test(candidate.generation) && typeof candidate.step === "string" && steps.has(candidate.step) &&
		typeof candidate.draft === "object" && candidate.draft !== null && !Array.isArray(candidate.draft) &&
		(candidate.requestId === undefined || (Number.isSafeInteger(candidate.requestId) && (candidate.requestId as number) >= -2147483648 && (candidate.requestId as number) <= 2147483647)) &&
		(candidate.continuation === undefined || (typeof candidate.continuation === "object" && candidate.continuation !== null && !Array.isArray(candidate.continuation) && (candidate.continuation as { kind?: unknown }).kind === "create_collaboration"));
}
