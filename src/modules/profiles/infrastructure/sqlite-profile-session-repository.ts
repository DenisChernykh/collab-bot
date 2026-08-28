import type {
	ProfileSessionRecord,
	ProfileSessionRepository,
	ProfileSessionState,
} from "../application/ports/profile-session-repository.js";
import type { WizardAdmission } from "../../../shared/application/ports/wizard-admission.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import { SqliteWizardAdmission } from "../../../platform/database/wizard-admission.js";

interface SessionRow {
	telegram_user_id?: unknown;
	state_json?: unknown;
	revision?: unknown;
	expires_at?: unknown;
	updated_at?: unknown;
}

export class SqliteProfileSessionRepository implements ProfileSessionRepository {
	private readonly database: SqlDatabase;

	constructor(
		source: SqlDatabaseInput,
		private readonly admission: WizardAdmission = new SqliteWizardAdmission(source),
	) {
		this.database = resolveSqlDatabase(source);
	}

	async findActive(telegramUserId: string, now: number): Promise<ProfileSessionRecord | undefined> {
		const rows = await this.database.query<SessionRow>(
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
		await this.database.withTransaction(async () => {
			await this.admission.assertAvailable("profile", record.telegramUserId, record.updatedAt);
			await this.database.execute(
				`INSERT INTO profile_sessions (telegram_user_id, flow_type, step, state_json, revision, expires_at, updated_at)
				 VALUES (?, 'profile', ?, ?, ?, ?, ?)
				 ON CONFLICT(telegram_user_id) DO UPDATE SET flow_type = 'profile', step = excluded.step, state_json = excluded.state_json, revision = excluded.revision, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
				[record.telegramUserId, record.state.step, JSON.stringify(record.state), record.revision, record.expiresAt, record.updatedAt],
			);
		});
	}

	async delete(telegramUserId: string): Promise<void> {
		await this.database.execute("DELETE FROM profile_sessions WHERE telegram_user_id = ?", [telegramUserId]);
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
	const steps = new Set(["type", "display_name", "topics", "description", "platform", "platform_url", "audience", "review", "application_message"]);
	if (!(candidate.version === 1 && typeof candidate.generation === "string" && /^[a-f0-9]{16}$/.test(candidate.generation) && typeof candidate.step === "string" && steps.has(candidate.step) &&
		typeof candidate.draft === "object" && candidate.draft !== null && !Array.isArray(candidate.draft) &&
		(candidate.requestId === undefined || (Number.isSafeInteger(candidate.requestId) && (candidate.requestId as number) >= -2147483648 && (candidate.requestId as number) <= 2147483647)))) return false;

	const continuation = parseContinuation(candidate.continuation);
	if (candidate.continuation !== undefined && continuation === undefined) return false;
	if (candidate.step === "application_message") return continuation?.kind === "submit_application";
	if (continuation?.kind !== "submit_application") return true;

	return new Set(["type", "display_name", "platform", "platform_url"]).has(candidate.step);
}

function parseContinuation(value: unknown): ProfileSessionState["continuation"] | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, unknown>;
	if (candidate.kind === "create_collaboration") {
		return Object.keys(candidate).length === 1 ? { kind: "create_collaboration" } : undefined;
	}
	if (candidate.kind !== "submit_application" || Object.keys(candidate).length !== 3) return undefined;
	if (typeof candidate.collaborationId !== "string" || !isUuid(candidate.collaborationId)) return undefined;
	if (candidate.source !== "feed" && candidate.source !== "deep_link") return undefined;
	return { kind: "submit_application", collaborationId: candidate.collaborationId, source: candidate.source };
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
