import type { CollaborationSessionRepository, CollaborationSessionRecord } from "../../application/ports/collaboration-session-repository.js";
import type { CollaborationDraftState } from "../../domain/collaborations/collaboration.js";
import type { DatabaseBoundary } from "./database-boundary.js";

interface SessionRow {
	telegram_user_id?: unknown;
	collaboration_id?: unknown;
	state_json?: unknown;
	revision?: unknown;
	expires_at?: unknown;
	updated_at?: unknown;
}

export class SqliteCollaborationSessionRepository implements CollaborationSessionRepository {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findActive(telegramUserId: string, now: number): Promise<CollaborationSessionRecord | undefined> {
		const rows = await this.boundary.query<SessionRow>(
			"SELECT telegram_user_id, collaboration_id, state_json, revision, expires_at, updated_at FROM collaboration_sessions WHERE telegram_user_id = ? AND expires_at > ?",
			[telegramUserId, now],
		);
		const row = rows[0];
		if (row === undefined || !isSessionRow(row, telegramUserId)) return undefined;
		return {
			telegramUserId,
			collaborationId: row.collaboration_id as string,
			state: parseState(row.state_json as string),
			revision: row.revision as number,
			expiresAt: row.expires_at as number,
			updatedAt: row.updated_at as number,
		};
	}

	async save(record: CollaborationSessionRecord): Promise<void> {
		if (!isSessionRow({ telegram_user_id: record.telegramUserId, collaboration_id: record.collaborationId, state_json: JSON.stringify(record.state), revision: record.revision, expires_at: record.expiresAt, updated_at: record.updatedAt }, record.telegramUserId)) throw new Error("invalid collaboration session record");
		await this.boundary.withTransaction(async () => {
			const profileRows = await this.boundary.query<{ telegram_user_id: unknown }>("SELECT telegram_user_id FROM profile_sessions WHERE telegram_user_id = ? AND expires_at > ?", [record.telegramUserId, record.updatedAt]);
			if (profileRows.length > 0) throw new Error("another wizard is already active");
			await this.boundary.execute(
				`INSERT INTO collaboration_sessions (telegram_user_id, collaboration_id, flow_type, step, state_json, revision, expires_at, updated_at)
				 VALUES (?, ?, 'collaboration', ?, ?, ?, ?, ?)
				 ON CONFLICT(telegram_user_id) DO UPDATE SET collaboration_id = excluded.collaboration_id, flow_type = 'collaboration', step = excluded.step, state_json = excluded.state_json, revision = excluded.revision, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
				[record.telegramUserId, record.collaborationId, record.state.step, JSON.stringify(record.state), record.revision, record.expiresAt, record.updatedAt],
			);
		});
	}

	async delete(telegramUserId: string): Promise<void> {
		await this.boundary.execute("DELETE FROM collaboration_sessions WHERE telegram_user_id = ?", [telegramUserId]);
	}
}

function isSessionRow(row: SessionRow, telegramUserId: string): boolean {
	return typeof row.telegram_user_id === "string" && row.telegram_user_id === telegramUserId && typeof row.collaboration_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.collaboration_id) && typeof row.state_json === "string" && isJsonObject(row.state_json) && Number.isSafeInteger(row.revision) && (row.revision as number) >= 0 && Number.isSafeInteger(row.expires_at) && (row.expires_at as number) >= 0 && Number.isSafeInteger(row.updated_at) && (row.updated_at as number) >= 0;
}

function parseState(value: string): CollaborationDraftState {
	let parsed: unknown;
	try { parsed = JSON.parse(value); } catch { throw new Error("collaboration session state is corrupt"); }
	if (!isCollaborationDraftState(parsed)) throw new Error("collaboration session state is unsupported");
	return parsed;
}

function isJsonObject(value: string): boolean {
	try { const parsed = JSON.parse(value) as unknown; return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed); } catch { return false; }
}

function isCollaborationDraftState(value: unknown): value is CollaborationDraftState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const steps = new Set(["format", "target_profile_type", "topics", "title", "offer", "expectation", "slots", "deadline", "event_date", "preview"]);
	return candidate.version === 1 && typeof candidate.generation === "string" && /^[a-f0-9]{16}$/.test(candidate.generation) && typeof candidate.step === "string" && steps.has(candidate.step);
}
