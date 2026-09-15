import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import { MFM_EVENT_STATUSES, MFM_OPEN_TO, MFM_PROFILE_TYPES, MFM_SPHERES, mfmAbout, mfmText, mfmValue, validateMfmContact, validateMfmPhoto, validateMfmProfile, type MfmContact, type MfmDraft, type MfmProfileInput, type MfmProfileRecord } from "../domain/mfm-profile.js";
import { LEGACY_ONBOARDING_STEPS, ONBOARDING_STEPS, type ExperienceUser, type OnboardingRepository, type OnboardingSession, type OnboardingState } from "../application/ports/onboarding-repository.js";

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
		const [row] = await this.database.query<{ profile_id: string; display_name: string; event_status: string; profile_type: string; location_text: string; about_text: string | null; photo_json: string | null; completed_at: number; updated_at: number; revision: number }>("SELECT m.*, p.display_name FROM mfm_profiles m JOIN profiles p ON p.id = m.profile_id WHERE p.telegram_user_id = ? AND p.status = 'active'", [userId]);
		if (row === undefined) return undefined;
		const spheres = await this.database.query<{ sphere: string }>("SELECT sphere FROM mfm_profile_spheres WHERE profile_id = ? ORDER BY rowid", [row.profile_id]);
		const openTo = await this.database.query<{ intent: string }>("SELECT intent FROM mfm_profile_open_to WHERE profile_id = ? ORDER BY rowid", [row.profile_id]);
		const [contactRow] = await this.database.query<{ kind: string; url: string | null; username: string | null; telegram_chat_id: string | null; title: string | null }>("SELECT kind, url, username, telegram_chat_id, title FROM mfm_profile_contacts WHERE profile_id = ?", [row.profile_id]);
		const contact = contactRow === undefined ? null : validateMfmContact(contactRow.kind === "telegram_user" ? { kind: contactRow.kind }
			: contactRow.kind === "external" ? { kind: contactRow.kind, url: contactRow.url }
				: { kind: contactRow.kind, url: contactRow.url, username: contactRow.username, telegramChatId: contactRow.telegram_chat_id, ...(contactRow.title === null ? {} : { title: contactRow.title }) });
		return { ...validateMfmProfile({ eventStatus: row.event_status, displayName: row.display_name, profileType: row.profile_type, locationText: row.location_text, spheres: spheres.map((x) => x.sphere), openTo: openTo.map((x) => x.intent), about: row.about_text, photo: row.photo_json === null ? null : JSON.parse(row.photo_json) }), profileId: row.profile_id, contact, completedAt: row.completed_at, updatedAt: row.updated_at, revision: row.revision };
	}
	async saveProfile(userId: string, input: MfmProfileInput, now: number, contact?: MfmContact | null): Promise<MfmProfileRecord> {
		const checked = validateMfmProfile(input);
		const checkedContact = contact === undefined || contact === null ? contact : validateMfmContact(contact);
		return this.database.withTransaction(async () => {
			const user = await this.getUser(userId);
			if (user?.status !== "active" || user.experience !== "mfm") throw new Error("MFM user unavailable");
			const [base] = await this.database.query<{ id: string }>("SELECT id FROM profiles WHERE telegram_user_id = ? AND status = 'active'", [userId]);
			if (base === undefined) throw new Error("base profile unavailable");
			await this.database.execute("UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ?", [checked.displayName, now, base.id]);
			await this.database.execute("INSERT INTO mfm_profiles (profile_id, event_status, profile_type, location_text, completed_at, updated_at, revision, about_text, photo_json) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET event_status = excluded.event_status, profile_type = excluded.profile_type, location_text = excluded.location_text, about_text = excluded.about_text, photo_json = excluded.photo_json, updated_at = excluded.updated_at, revision = mfm_profiles.revision + 1", [base.id, checked.eventStatus, checked.profileType, checked.locationText, now, now, checked.about, checked.photo == null ? null : JSON.stringify(checked.photo)]);
			await this.database.execute("DELETE FROM mfm_profile_spheres WHERE profile_id = ?", [base.id]);
			await this.database.execute("DELETE FROM mfm_profile_open_to WHERE profile_id = ?", [base.id]);
			for (const sphere of checked.spheres) await this.database.execute("INSERT INTO mfm_profile_spheres VALUES (?, ?)", [base.id, sphere]);
			for (const key of checked.openTo) await this.database.execute("INSERT INTO mfm_profile_open_to VALUES (?, ?)", [base.id, key]);
			if (checkedContact !== undefined) {
				await this.database.execute("DELETE FROM mfm_profile_contacts WHERE profile_id = ?", [base.id]);
				if (checkedContact !== null) await this.database.execute(
					"INSERT INTO mfm_profile_contacts (profile_id, kind, url, username, telegram_chat_id, title, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
					[base.id, checkedContact.kind, "url" in checkedContact ? checkedContact.url : null, "username" in checkedContact ? checkedContact.username : null, "telegramChatId" in checkedContact ? checkedContact.telegramChatId : null, "title" in checkedContact ? checkedContact.title ?? null : null, now],
				);
			}
			const saved = await this.getProfile(userId);
			if (saved === undefined) throw new Error("MFM profile unavailable");
			return saved;
		});
	}
}

function parseState(value: unknown): OnboardingState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid onboarding state");
	const v = value as Record<string, unknown>;
	if (v.version !== 1 || typeof v.generation !== "string" || !/^[a-f0-9]{16}$/.test(v.generation) || typeof v.editing !== "boolean") throw new Error("unsupported onboarding state");
	const draft = parseDraft(v.draft);
	const rawStep = mfmValue(v.step, [...ONBOARDING_STEPS, ...LEGACY_ONBOARDING_STEPS]);
	const step = normalizeStep(rawStep);
	const rawReturnStep = v.returnStep === undefined ? undefined : mfmValue(v.returnStep, [...ONBOARDING_STEPS, ...LEGACY_ONBOARDING_STEPS, "home"]);
	return { version: 1, generation: v.generation, step, draft, editing: v.editing,
		...(v.photoCandidate === undefined ? {} : { photoCandidate: validateMfmPhoto(v.photoCandidate) }),
		...(v.photoOnly === true ? { photoOnly: true } : {}),
		...(v.contact === undefined ? {} : { contact: v.contact === null ? null : validateMfmContact(v.contact) }),
		...(v.pendingStart === undefined ? {} : { pendingStart: mfmText(v.pendingStart, 64) }),
		...(rawReturnStep === undefined ? {} : { returnStep: rawReturnStep === "home" ? rawReturnStep : normalizeStep(rawReturnStep) }),
	};
}
function normalizeStep(step: (typeof ONBOARDING_STEPS)[number] | (typeof LEGACY_ONBOARDING_STEPS)[number]): OnboardingState["step"] {
	if (step === "intro") return "display_name";
	if (step === "specializations" || step === "enrichment_specializations") return "open_to";
	return step;
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
		...(v.openTo === undefined ? {} : { openTo: draftChoices(v.openTo, MFM_OPEN_TO) }),
		...(v.photo === undefined ? {} : { photo: v.photo === null ? null : validateMfmPhoto(v.photo) }),
		...(v.about === undefined ? {} : { about: v.about === null ? null : mfmAbout(v.about) }),
	};
}
function draftChoices<T extends string>(value: unknown, allowed: readonly T[]): readonly T[] {
	if (!Array.isArray(value) || value.length > 3 || new Set(value).size !== value.length) throw new Error("invalid MFM draft choices");
	return value.map((x: unknown) => mfmValue(x, allowed));
}
