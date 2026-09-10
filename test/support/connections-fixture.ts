import type { SqlDatabase } from "../../src/shared/application/ports/sql-database.js";
import type { MfmProfileInput } from "../../src/modules/profiles/application/index.js";
import { createConnectionsFeature } from "../../src/modules/connections/index.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import { FakeClock } from "./fake-clock.js";

export const connectionClock = new FakeClock(1_700_000_000_000);
export const connectionProfileId = (id: number) => `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
export function connectionsFor(database: SqlDatabase, enabled = true) {
	return createConnectionsFeature({ database, transactions: new DatabaseBoundaryTransactionRunner(database), clock: connectionClock, crypto: webCryptoCapabilities, mfmFeatureEnabled: enabled });
}
export async function seedConnectionPerson(database: SqlDatabase, id: number, input: Partial<MfmProfileInput> & { language?: "ru" | "en"; experience?: "mfm" | "classic"; blocked?: boolean; incomplete?: boolean } = {}) {
	const profileId = connectionProfileId(id);
	await database.execute("INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, experience, preferred_language, created_at, updated_at) VALUES (?, ?, 'Synthetic Person', ?, ?, ?, ?, 1, 1)", [String(id), `private_person_${id}`, input.blocked ? "blocked" : "active", input.blocked ? 1 : null, input.experience ?? "mfm", input.language ?? "ru"]);
	await database.execute("INSERT INTO profiles (id, telegram_user_id, display_name, type, city_code, status, created_at, updated_at) VALUES (?, ?, ?, NULL, 'ekaterinburg', 'active', 1, 1)", [profileId, String(id), input.displayName ?? `Synthetic ${id}`]);
	if (input.incomplete || input.experience === "classic") return profileId;
	await database.execute("INSERT INTO mfm_profiles VALUES (?, ?, 'specialist', 'Synthetic City', ?, ?, 1)", [profileId, input.eventStatus ?? "participant", id, id]);
	for (const sphere of input.spheres ?? ["digital_it"]) await database.execute("INSERT INTO mfm_profile_spheres VALUES (?, ?)", [profileId, sphere]);
	for (const specialization of input.specializations ?? ["ai"]) await database.execute("INSERT INTO mfm_profile_specializations VALUES (?, 'digital_it', ?)", [profileId, specialization]);
	for (const intent of input.openTo ?? ["joint_projects"]) await database.execute("INSERT INTO mfm_profile_open_to VALUES (?, ?)", [profileId, intent]);
	return profileId;
}
