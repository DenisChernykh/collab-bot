import { expect, it } from "vitest";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import { validateMfmProfile } from "../../src/modules/profiles/domain/mfm-profile.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { FakeClock } from "../support/fake-clock.js";
import { exportStateTransferManifest } from "../../src/platform/database/state-transfer.js";

it("persists and replaces one MFM extension, preserving the base ID and classic type", async () => {
	await withFreshMigratedDatabase({ prefix: "mfm-repo-", clock: new FakeClock(100) }, async ({ boundary }) => {
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('1', 'Initial', 'active', 1, 1)");
		const base = await new SqliteProfileRepository(boundary).createInitial("1", "Initial", 1);
		const repository = new SqliteOnboardingRepository(boundary);
		await repository.setUser("1", "en", "mfm");
		const session = await repository.saveSession("1", { version: 1, generation: "a".repeat(16), step: "spheres", draft: { displayName: "Lucas" }, editing: false, page: 0 }, 2);
		expect(await new SqliteOnboardingRepository(boundary).getSession("1")).toEqual(session);
		const input = validateMfmProfile({ eventStatus: "volunteer", displayName: "Lucas", profileType: "specialist", locationText: "Belgrade, Serbia", spheres: ["media"], specializations: ["blogger"], openTo: ["professional_communication"] });
		const saved = await repository.saveProfile("1", input, 3);
		expect(saved).toMatchObject({ ...input, profileId: base.id, revision: 1 });
		await repository.saveProfile("1", { ...input, spheres: ["digital_it"], specializations: ["ai"] }, 4);
		expect(await repository.getProfile("1")).toMatchObject({ profileId: base.id, spheres: ["digital_it"], specializations: ["ai"], completedAt: 3, revision: 2 });
		expect(await boundary.query("SELECT type, display_name FROM profiles")).toEqual([{ type: null, display_name: "Lucas" }]);
		expect(await boundary.query("SELECT * FROM profile_platforms")).toEqual([]);
		await boundary.execute("CREATE TRIGGER mfm_fail BEFORE INSERT ON mfm_profile_open_to BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
		await expect(repository.saveProfile("1", { ...input, displayName: "Changed" }, 5)).rejects.toThrow("synthetic failure");
		expect(await repository.getProfile("1")).toMatchObject({ displayName: "Lucas", spheres: ["digital_it"], revision: 2 });
		expect((await exportStateTransferManifest(boundary)).tables.find((t) => t.name === "mfm_profiles")?.rowCount).toBe(1);
		expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);
	});
});
