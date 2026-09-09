import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import { MFM_EVENT_STATUSES, MFM_OPEN_TO, MFM_PROFILE_TYPES, MFM_SPECIALIZATIONS, MFM_SPHERES, mfmText, mfmValue, specializationSphere, validateMfmProfile, type MfmDraft, type MfmProfileInput, type MfmProfileRecord } from "../domain/mfm-profile.js";
import { ONBOARDING_STEPS, type ExperienceUser, type OnboardingRepository, type OnboardingSession, type OnboardingState } from "../application/ports/onboarding-repository.js";

export class SqliteOnboardingRepository implements OnboardingRepository {
	private readonly database: SqlDatabase;
	constructor(source: SqlDatabaseInput) { this.database = resolveSqlDatabase(source); }
	async getUser(userId: string): Promise<ExperienceUser | undefined> {
		const [row] = await this.database.query<{ preferred_language: unknown; experience: unknown; status: unknown }>("SELECT preferred_language, experience, status FROM telegram_users WHERE telegram_user_id = ?", [userId]);
		return row === undefined ? undefined : {
			language: row.preferred_language === null ? null : mfmValue(row.preferred_language, ["ru", "en"]),
			experience: mfmValue(row.experience, ["undecided", "classic", "mfm"]), status: mfmValue(row.status, ["active", "blocked"]),
		};
	}
	async setUser(userId: string, language: ExperienceUser["language"], experience: ExperienceUser["experience"]): Promise<void> {
		const result = await this.database.execute("UPDATE telegram_users SET preferred_language = ?, experience = ? WHERE telegram_user_id = ? AND status = 'active'", [language, experience, userId]);
		if (result.changes !== 1) throw new Error("active onboarding user unavailable");
	}
	async getSession(userId: string): Promise<OnboardingSession | undefined> {
		const [row] = await this.database.query<{ state_json: string; revision: number; updated_at: number }>("SELECT state_json, revision, updated_at FROM onboarding_sessions WHERE telegram_user_id = ?", [userId]);
		return row === undefined ? undefined : { state: parseState(JSON.parse(row.state_json)), revision: row.revision, updatedAt: row.updated_at };
	}
	async saveSession(userId: string, state: OnboardingState, now: number): Promise<OnboardingSession> {
		const checked = parseState(state);
		return this.database.withTransaction(async () => {
			await this.database.execute("INSERT INTO onboarding_sessions (telegram_user_id, state_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(telegram_user_id) DO UPDATE SET state_json = excluded.state_json, revision = onboarding_sessions.revision + 1, updated_at = excluded.updated_at", [userId, JSON.stringify(checked), now]);
			const saved = await this.getSession(userId);
			if (saved === undefined) throw new Error("onboarding session unavailable");
			return saved;
		});
	}
	async deleteSession(userId: string): Promise<void> { await this.database.execute("DELETE FROM onboarding_sessions WHERE telegram_user_id = ?", [userId]); }
	async getProfile(userId: string): Promise<MfmProfileRecord | undefined> {
		const [row] = await this.database.query<{ profile_id: string; display_name: string; event_status: string; profile_type: string; location_text: string; completed_at: number; updated_at: number; revision: number }>("SELECT m.*, p.display_name FROM mfm_profiles m JOIN profiles p ON p.id = m.profile_id WHERE p.telegram_user_id = ? AND p.status = 'active'", [userId]);
		if (row === undefined) return undefined;
		const spheres = await this.database.query<{ sphere: string }>("SELECT sphere FROM mfm_profile_spheres WHERE profile_id = ? ORDER BY rowid", [row.profile_id]);
		const specializations = await this.database.query<{ specialization: string }>("SELECT specialization FROM mfm_profile_specializations WHERE profile_id = ? ORDER BY rowid", [row.profile_id]);
		const openTo = await this.database.query<{ intent: string }>("SELECT intent FROM mfm_profile_open_to WHERE profile_id = ? ORDER BY rowid", [row.profile_id]);
		return { ...validateMfmProfile({ eventStatus: row.event_status, displayName: row.display_name, profileType: row.profile_type, locationText: row.location_text, spheres: spheres.map((x) => x.sphere), specializations: specializations.map((x) => x.specialization), openTo: openTo.map((x) => x.intent) }), profileId: row.profile_id, completedAt: row.completed_at, updatedAt: row.updated_at, revision: row.revision };
	}
	async saveProfile(userId: string, input: MfmProfileInput, now: number): Promise<MfmProfileRecord> {
		const checked = validateMfmProfile(input);
		return this.database.withTransaction(async () => {
			const user = await this.getUser(userId);
			if (user?.status !== "active" || user.experience !== "mfm") throw new Error("MFM user unavailable");
			const [base] = await this.database.query<{ id: string }>("SELECT id FROM profiles WHERE telegram_user_id = ? AND status = 'active'", [userId]);
			if (base === undefined) throw new Error("base profile unavailable");
			await this.database.execute("UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ?", [checked.displayName, now, base.id]);
			await this.database.execute("INSERT INTO mfm_profiles VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(profile_id) DO UPDATE SET event_status = excluded.event_status, profile_type = excluded.profile_type, location_text = excluded.location_text, updated_at = excluded.updated_at, revision = mfm_profiles.revision + 1", [base.id, checked.eventStatus, checked.profileType, checked.locationText, now, now]);
			await this.database.execute("DELETE FROM mfm_profile_spheres WHERE profile_id = ?", [base.id]);
			await this.database.execute("DELETE FROM mfm_profile_open_to WHERE profile_id = ?", [base.id]);
			for (const sphere of checked.spheres) await this.database.execute("INSERT INTO mfm_profile_spheres VALUES (?, ?)", [base.id, sphere]);
			for (const key of checked.specializations) await this.database.execute("INSERT INTO mfm_profile_specializations VALUES (?, ?, ?)", [base.id, specializationSphere(key), key]);
			for (const key of checked.openTo) await this.database.execute("INSERT INTO mfm_profile_open_to VALUES (?, ?)", [base.id, key]);
			const saved = await this.getProfile(userId);
			if (saved === undefined) throw new Error("MFM profile unavailable");
			return saved;
		});
	}
}

function parseState(value: unknown): OnboardingState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid onboarding state");
	const v = value as Record<string, unknown>;
	if (v.version !== 1 || typeof v.generation !== "string" || !/^[a-f0-9]{16}$/.test(v.generation) || typeof v.editing !== "boolean" || !Number.isSafeInteger(v.page) || (v.page as number) < 0 || (v.page as number) > 2) throw new Error("unsupported onboarding state");
	const step = mfmValue(v.step, ONBOARDING_STEPS);
	const draft = parseDraft(v.draft);
	return { version: 1, generation: v.generation, step, draft, editing: v.editing, page: v.page as number,
		...(v.pendingStart === undefined ? {} : { pendingStart: mfmText(v.pendingStart, 64) }),
		...(v.returnStep === undefined ? {} : { returnStep: mfmValue(v.returnStep, [...ONBOARDING_STEPS, "home"]) }),
	};
}
function parseDraft(value: unknown): MfmDraft {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid MFM draft");
	const v = value as Record<string, unknown>;
	return {
		...(v.eventStatus === undefined ? {} : { eventStatus: mfmValue(v.eventStatus, MFM_EVENT_STATUSES) }),
		...(v.profileType === undefined ? {} : { profileType: mfmValue(v.profileType, MFM_PROFILE_TYPES) }),
		...(v.displayName === undefined ? {} : { displayName: mfmText(v.displayName, 100) }),
		...(v.locationText === undefined ? {} : { locationText: mfmText(v.locationText, 200) }),
		...(v.spheres === undefined ? {} : { spheres: draftChoices(v.spheres, MFM_SPHERES) }),
		...(v.specializations === undefined ? {} : { specializations: draftChoices(v.specializations, Object.values(MFM_SPECIALIZATIONS).flat()) }),
		...(v.openTo === undefined ? {} : { openTo: draftChoices(v.openTo, MFM_OPEN_TO) }),
	};
}
function draftChoices<T extends string>(value: unknown, allowed: readonly T[]): readonly T[] {
	if (!Array.isArray(value) || value.length > 3 || new Set(value).size !== value.length) throw new Error("invalid MFM draft choices");
	return value.map((x: unknown) => mfmValue(x, allowed));
}
