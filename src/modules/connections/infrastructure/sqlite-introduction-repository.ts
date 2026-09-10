import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import type { Language } from "../../profiles/application/index.js";
import type { IntroductionTab } from "../application/connection-model.js";
import type { IntroductionRecord, IntroductionRepository, IntroductionStatus } from "../application/introduction-contracts.js";
import { SqliteConnectionRepository } from "./sqlite-connection-repository.js";

const COLUMNS = "id, public_token AS token, sender_profile_id AS senderProfileId, recipient_profile_id AS recipientProfileId, message, status, revision, created_at AS createdAt, decided_at AS decidedAt";
export class SqliteIntroductionRepository extends SqliteConnectionRepository implements IntroductionRepository {
	constructor(private readonly sql: SqlDatabase) { super(sql); }
	async findRequest(token: string): Promise<IntroductionRecord | undefined> { return (await this.sql.query<IntroductionRecord>(`SELECT ${COLUMNS} FROM introduction_requests WHERE public_token = ?`, [token]))[0]; }
	async findPair(first: string, second: string): Promise<IntroductionRecord | undefined> {
		return (await this.sql.query<IntroductionRecord>(`SELECT ${COLUMNS} FROM introduction_requests WHERE (sender_profile_id = ? AND recipient_profile_id = ?) OR (sender_profile_id = ? AND recipient_profile_id = ?)`, [first, second, second, first]))[0];
	}
	async insertRequest(r: IntroductionRecord): Promise<void> {
		await this.sql.execute("INSERT INTO introduction_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [r.id, r.token, r.senderProfileId, r.recipientProfileId, r.message, r.status, r.revision, r.createdAt, r.decidedAt]);
	}
	async decide(r: IntroductionRecord, status: Exclude<IntroductionStatus, "pending">, now: number): Promise<void> {
		const result = await this.sql.execute("UPDATE introduction_requests SET status = ?, revision = revision + 1, decided_at = ? WHERE id = ? AND status = 'pending' AND revision = ?", [status, now, r.id, r.revision]);
		if (result.changes !== 1) throw new Error("introduction changed during decision");
	}
	listRequests(profileId: string, tab: IntroductionTab, offset: number): Promise<readonly IntroductionRecord[]> {
		const predicate = tab === "incoming" ? "recipient_profile_id = ?" : tab === "sent" ? "sender_profile_id = ?" : "(sender_profile_id = ? OR recipient_profile_id = ?) AND status = 'accepted'";
		return this.sql.query<IntroductionRecord>(`SELECT ${COLUMNS} FROM introduction_requests WHERE ${predicate} ORDER BY created_at DESC, id LIMIT 2 OFFSET ?`, tab === "accepted" ? [profileId, profileId, offset] : [profileId, offset]);
	}
	async getDeliveryTarget(profileId: string): Promise<{ userId: string; language: Language } | undefined> {
		return (await this.sql.query<{ userId: string; language: Language }>("SELECT u.telegram_user_id AS userId, coalesce(u.preferred_language, 'ru') AS language FROM profiles p JOIN telegram_users u ON u.telegram_user_id = p.telegram_user_id WHERE p.id = ? AND p.status = 'active' AND u.status = 'active' AND u.experience = 'mfm'", [profileId]))[0];
	}
	async getContactUrl(profileId: string): Promise<string | null> {
		const [row] = await this.sql.query<{ username: string | null; telegram_user_id: string }>("SELECT u.username, u.telegram_user_id FROM profiles p JOIN telegram_users u ON u.telegram_user_id = p.telegram_user_id WHERE p.id = ? AND p.status = 'active' AND u.status = 'active' AND u.experience = 'mfm'", [profileId]);
		if (row === undefined) return null;
		if (row.username !== null && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(row.username)) return `https://t.me/${row.username}`;
		return /^[1-9][0-9]{0,19}$/.test(row.telegram_user_id) ? `tg://user?id=${row.telegram_user_id}` : null;
	}
}
