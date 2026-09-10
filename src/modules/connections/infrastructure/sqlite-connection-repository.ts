import type { SqlDatabase, SqlValue } from "../../../shared/application/ports/sql-database.js";
import { validateMfmProfile, type Language } from "../../profiles/application/index.js";
import { parseConnectionState, type ConnectionActor, type ConnectionSession, type ConnectionState, type PublicPerson, type SearchFilters } from "../application/connection-model.js";
import type { ConnectionRepository } from "../application/ports/connection-repository.js";

const ELIGIBLE = "u.status = 'active' AND u.experience = 'mfm' AND p.status = 'active'";
export class SqliteConnectionRepository implements ConnectionRepository {
	constructor(private readonly database: SqlDatabase) {}
	async getActor(userId: string): Promise<ConnectionActor | undefined> {
		const [row] = await this.database.query<{ profile_id: string; preferred_language: Language | null }>(`SELECT m.profile_id, u.preferred_language FROM telegram_users u JOIN profiles p ON p.telegram_user_id = u.telegram_user_id JOIN mfm_profiles m ON m.profile_id = p.id WHERE u.telegram_user_id = ? AND ${ELIGIBLE}`, [userId]);
		if (row === undefined) return undefined;
		const profile = await this.getPerson(row.profile_id);
		return profile === undefined ? undefined : { userId, language: row.preferred_language ?? "ru", profile };
	}
	async getPerson(profileId: string): Promise<PublicPerson | undefined> {
		const [row] = await this.database.query<{ display_name: string; event_status: string; profile_type: string; location_text: string }>(`SELECT p.display_name, m.event_status, m.profile_type, m.location_text FROM mfm_profiles m JOIN profiles p ON p.id = m.profile_id JOIN telegram_users u ON u.telegram_user_id = p.telegram_user_id WHERE p.id = ? AND ${ELIGIBLE}`, [profileId]);
		if (row === undefined) return undefined;
		const spheres = await this.database.query<{ sphere: string }>("SELECT sphere FROM mfm_profile_spheres WHERE profile_id = ? ORDER BY rowid", [profileId]);
		const specializations = await this.database.query<{ specialization: string }>("SELECT specialization FROM mfm_profile_specializations WHERE profile_id = ? ORDER BY rowid", [profileId]);
		const openTo = await this.database.query<{ intent: string }>("SELECT intent FROM mfm_profile_open_to WHERE profile_id = ? ORDER BY rowid", [profileId]);
		return { profileId, ...validateMfmProfile({ displayName: row.display_name, eventStatus: row.event_status, profileType: row.profile_type, locationText: row.location_text, spheres: spheres.map(x => x.sphere), specializations: specializations.map(x => x.specialization), openTo: openTo.map(x => x.intent) }) };
	}
	async getSession(userId: string): Promise<ConnectionSession | undefined> {
		const [row] = await this.database.query<{ state_json: string; revision: number; updated_at: number }>("SELECT state_json, revision, updated_at FROM connection_sessions WHERE telegram_user_id = ?", [userId]);
		return row === undefined ? undefined : { state: parseConnectionState(JSON.parse(row.state_json)), revision: row.revision, updatedAt: row.updated_at };
	}
	async saveSession(userId: string, state: ConnectionState, now: number): Promise<ConnectionSession> {
		await this.database.execute("INSERT INTO connection_sessions VALUES (?, ?, 1, ?) ON CONFLICT(telegram_user_id) DO UPDATE SET state_json = excluded.state_json, revision = connection_sessions.revision + 1, updated_at = excluded.updated_at", [userId, JSON.stringify(parseConnectionState(state)), now]);
		const saved = await this.getSession(userId);
		if (saved === undefined) throw new Error("connection session unavailable");
		return saved;
	}
	async isVisible(profileId: string): Promise<boolean> {
		const [row] = await this.database.query<{ visible: number }>("SELECT visible FROM mfm_discovery_settings WHERE profile_id = ?", [profileId]);
		return row === undefined || row.visible === 1;
	}
	async setVisible(profileId: string, visible: boolean, now: number): Promise<void> {
		await this.database.execute("INSERT INTO mfm_discovery_settings VALUES (?, ?, 1, ?) ON CONFLICT(profile_id) DO UPDATE SET visible = excluded.visible, revision = mfm_discovery_settings.revision + 1, updated_at = excluded.updated_at", [profileId, visible ? 1 : 0, now]);
	}
	async search(excludeProfileId: string, filters: SearchFilters, offset: number): Promise<{ person: PublicPerson | null; hasNext: boolean }> {
		const conditions = [ELIGIBLE, "COALESCE(d.visible, 1) = 1", "p.id <> ?"];
		const values: SqlValue[] = [excludeProfileId];
		if (filters.eventStatus !== undefined) { conditions.push("m.event_status = ?"); values.push(filters.eventStatus); }
		if (filters.sphere !== undefined) { conditions.push("EXISTS (SELECT 1 FROM mfm_profile_spheres s WHERE s.profile_id = p.id AND s.sphere = ?)"); values.push(filters.sphere); }
		if (filters.specialization !== undefined) { conditions.push("EXISTS (SELECT 1 FROM mfm_profile_specializations s WHERE s.profile_id = p.id AND s.specialization = ?)"); values.push(filters.specialization); }
		if (filters.openTo !== undefined) { conditions.push("EXISTS (SELECT 1 FROM mfm_profile_open_to o WHERE o.profile_id = p.id AND o.intent = ?)"); values.push(filters.openTo); }
		const rows = await this.database.query<{ profile_id: string }>(`SELECT m.profile_id FROM mfm_profiles m JOIN profiles p ON p.id = m.profile_id JOIN telegram_users u ON u.telegram_user_id = p.telegram_user_id LEFT JOIN mfm_discovery_settings d ON d.profile_id = p.id WHERE ${conditions.join(" AND ")} ORDER BY m.completed_at, p.id LIMIT 2 OFFSET ?`, [...values, offset]);
		return { person: rows[0] === undefined ? null : (await this.getPerson(rows[0].profile_id)) ?? null, hasNext: rows.length > 1 };
	}
}
