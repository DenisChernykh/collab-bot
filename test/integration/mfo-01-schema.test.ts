import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";
import { NodeSqlDatabase } from "../../src/platform/database/node-sql-database.js";
import { exportStateTransferManifest, importStateTransferManifest, STATE_TRANSFER_AUDIT_TABLE } from "../../src/platform/database/state-transfer.js";

const profileId = "17000000-0000-4000-8000-000000000001";
const profileInput = { eventStatus: "participant" as const, displayName: "Saved person", profileType: "media" as const, locationText: "Yekaterinburg, Russia", spheres: ["media" as const], specializations: ["blogger" as const], openTo: ["joint_projects" as const] };
const contact = { kind: "telegram_group" as const, url: "https://t.me/public_group", username: "public_group", telegramChatId: "-10017", title: "Public group" };

it("upgrades populated schema16 without rewriting data and transfers one preferred contact", async () => {
	const directory = await mkdtemp(join(tmpdir(), "mfo-upgrade-"));
	const source = new DatabaseBoundary(join(directory, "source.sqlite"));
	const target = new DatabaseBoundary(join(directory, "target.sqlite"));
	try {
		const legacy = join(directory, "legacy");
		await mkdir(legacy);
		for (const name of await readdir("migrations")) if (Number(name.slice(0, 4)) <= 16) await copyFile(join("migrations", name), join(legacy, name));
		await new MigrationRunner(await MigrationSource.fromDirectory(legacy)).migrate(source);
		await source.execute("INSERT INTO telegram_users (telegram_user_id, username, display_name, status, experience, preferred_language, created_at, updated_at) VALUES ('17', 'saved_person', 'Saved person', 'active', 'mfm', 'en', 1, 1)");
		await source.execute("INSERT INTO profiles (id, telegram_user_id, display_name, type, city_code, status, created_at, updated_at) VALUES (?, '17', 'Saved person', NULL, 'ekaterinburg', 'active', 1, 1)", [profileId]);
		await source.execute("INSERT INTO mfm_profiles VALUES (?, 'participant', 'media', 'Yekaterinburg, Russia', 2, 2, 1)", [profileId]);
		await source.execute("INSERT INTO mfm_profile_spheres VALUES (?, 'media')", [profileId]);
		await source.execute("INSERT INTO mfm_profile_specializations VALUES (?, 'media', 'blogger')", [profileId]);
		await source.execute("INSERT INTO mfm_profile_open_to VALUES (?, 'joint_projects')", [profileId]);
		const before = {
			profile: await source.query("SELECT * FROM mfm_profiles"),
			specializations: await source.query("SELECT * FROM mfm_profile_specializations"),
			openTo: await source.query("SELECT * FROM mfm_profile_open_to"),
		};
		const runner = new MigrationRunner(await MigrationSource.fromDirectory("migrations"));
		expect((await runner.migrate(source)).applied).toEqual([17]);
		expect(await source.query("SELECT * FROM mfm_profiles")).toEqual(before.profile);
		expect(await source.query("SELECT * FROM mfm_profile_specializations")).toEqual(before.specializations);
		expect(await source.query("SELECT * FROM mfm_profile_open_to")).toEqual(before.openTo);
		expect(await source.query("SELECT * FROM mfm_profile_contacts")).toEqual([]);
		await source.execute("INSERT INTO mfm_profile_contacts (profile_id, kind, url, username, telegram_chat_id, title, updated_at) VALUES (?, 'telegram_group', ?, 'public_group', '-10017', 'Public group', 3)", [profileId, contact.url]);
		await expect(source.execute("UPDATE mfm_profile_contacts SET kind = 'unsupported' WHERE profile_id = ?", [profileId])).rejects.toThrow();
		await expect(source.execute("UPDATE mfm_profile_contacts SET telegram_chat_id = '17' WHERE profile_id = ?", [profileId])).rejects.toThrow();
		await runner.verify(source);
		await runner.migrate(target);
		await target.execute(`CREATE TABLE ${STATE_TRANSFER_AUDIT_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), digest TEXT NOT NULL, imported_at INTEGER NOT NULL)`);
		const manifest = await exportStateTransferManifest(new NodeSqlDatabase(source));
		expect(manifest.schemaVersion).toBe(17);
		expect(manifest.tables).toHaveLength(26);
		await importStateTransferManifest(new NodeSqlDatabase(target), manifest);
		expect((await exportStateTransferManifest(new NodeSqlDatabase(target))).digest).toBe(manifest.digest);
		expect(await target.query("SELECT kind, url, username, telegram_chat_id, title FROM mfm_profile_contacts")).toEqual([{ kind: contact.kind, url: contact.url, username: contact.username, telegram_chat_id: contact.telegramChatId, title: contact.title }]);
		expect(await target.query("PRAGMA foreign_key_check")).toEqual([]);
	} finally {
		await source.close();
		await target.close();
		await rm(directory, { recursive: true, force: true });
	}
});

it("persists, preserves and explicitly clears a preferred contact in the profile transaction", async () => {
	const directory = await mkdtemp(join(tmpdir(), "mfo-contact-"));
	const database = new DatabaseBoundary(join(directory, "app.sqlite"));
	try {
		await new MigrationRunner(await MigrationSource.fromDirectory("migrations")).migrate(database);
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('17', 'Saved person', 'active', 1, 1)");
		const base = await new SqliteProfileRepository(database).createInitial("17", "Saved person", 1);
		expect(base.id).not.toBe(profileId);
		const repository = new SqliteOnboardingRepository(database);
		await repository.setUser("17", "en", "mfm");
		await repository.saveProfile("17", profileInput, 2, contact);
		expect(await repository.getProfile("17")).toMatchObject({ ...profileInput, contact });
		await repository.saveProfile("17", { ...profileInput, displayName: "Changed" }, 3);
		expect((await repository.getProfile("17"))?.contact).toEqual(contact);
		await repository.saveProfile("17", profileInput, 4, null);
		expect((await repository.getProfile("17"))?.contact).toBeNull();
		await database.execute("CREATE TRIGGER mfo_contact_fail BEFORE INSERT ON mfm_profile_contacts BEGIN SELECT RAISE(ABORT, 'synthetic contact failure'); END");
		await expect(repository.saveProfile("17", { ...profileInput, displayName: "Not committed" }, 5, contact)).rejects.toThrow("synthetic contact failure");
		expect(await repository.getProfile("17")).toMatchObject({ displayName: profileInput.displayName, contact: null, revision: 3 });
	} finally {
		await database.close();
		await rm(directory, { recursive: true, force: true });
	}
});
