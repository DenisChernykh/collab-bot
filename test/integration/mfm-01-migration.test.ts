import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";

it.each([13, 14])("preserves populated schema %i and adds focused MFM data", async (version) => {
	const directory = await mkdtemp(join(tmpdir(), "mfm-upgrade-"));
	const database = new DatabaseBoundary(join(directory, "app.sqlite"));
	try {
		const previous = join(directory, "migrations");
		await mkdir(previous);
		for (const name of await readdir("migrations")) if (Number(name.slice(0, 4)) <= version) await copyFile(join("migrations", name), join(previous, name));
		await new MigrationRunner(await MigrationSource.fromDirectory(previous)).migrate(database);
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('100', 'Saved user', 'active', 1, 1)");
		const id = "11111111-1111-4111-8111-111111111111";
		await database.execute("INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at) VALUES (?, '100', 'blogger', 'Saved title', 'ekaterinburg', 'active', 1, 1)", [id]);
		const before = await database.query("SELECT * FROM profiles");
		const runner = new MigrationRunner(await MigrationSource.fromDirectory("migrations"));
		expect((await runner.migrate(database)).applied).toEqual(expect.arrayContaining([15, 18]));
		expect(await database.query("SELECT * FROM profiles")).toEqual(before);
		expect(await database.query("SELECT experience, preferred_language FROM telegram_users")).toEqual([{ experience: "classic", preferred_language: null }]);
		await database.execute("INSERT INTO mfm_profiles (profile_id, event_status, profile_type, location_text, completed_at, updated_at, revision, about_text) VALUES (?, 'volunteer', 'specialist', 'São Paulo, Brazil', 2, 2, 1, 'I connect useful local projects.')", [id]);
		await database.execute("INSERT INTO mfm_profile_spheres VALUES (?, 'media')", [id]);
		await database.execute("INSERT INTO mfm_profile_open_to VALUES (?, 'joint_projects')", [id]);
		expect(await database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mfm_profile_specializations'")).toEqual([]);
		await expect(database.execute("INSERT INTO mfm_profile_spheres VALUES (?, 'media')", [id])).rejects.toThrow();
		await expect(database.execute("INSERT INTO mfm_profile_open_to VALUES (?, 'anything')", [id])).rejects.toThrow();
		await expect(database.execute("UPDATE mfm_profiles SET about_text = 'short' WHERE profile_id = ?", [id])).rejects.toThrow();
		expect(await database.query("PRAGMA foreign_key_check")).toEqual([]);
		expect(await database.query("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
		expect((await runner.migrate(database)).applied).toEqual([]);
	} finally { await database.close(); await rm(directory, { recursive: true, force: true }); }
});

it("drops schema17 specialization rows and preserves the remaining MFM profile", async () => {
	const directory = await mkdtemp(join(tmpdir(), "mfp-schema18-upgrade-"));
	const database = new DatabaseBoundary(join(directory, "app.sqlite"));
	try {
		const previous = join(directory, "migrations");
		await mkdir(previous);
		for (const name of await readdir("migrations")) if (Number(name.slice(0, 4)) <= 17) await copyFile(join("migrations", name), join(previous, name));
		await new MigrationRunner(await MigrationSource.fromDirectory(previous)).migrate(database);
		await database.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, experience, preferred_language, created_at, updated_at) VALUES ('100', 'Saved user', 'active', 'mfm', 'ru', 1, 1)");
		const id = "11111111-1111-4111-8111-111111111111";
		await database.execute("INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at) VALUES (?, '100', NULL, 'Saved title', 'ekaterinburg', 'active', 1, 1)", [id]);
		await database.execute("INSERT INTO mfm_profiles VALUES (?, 'volunteer', 'specialist', 'Екатеринбург, Россия', 2, 2, 1)", [id]);
		await database.execute("INSERT INTO mfm_profile_spheres VALUES (?, 'media')", [id]);
		await database.execute("INSERT INTO mfm_profile_specializations VALUES (?, 'media', 'blogger')", [id]);
		await database.execute("INSERT INTO mfm_profile_open_to VALUES (?, 'joint_projects')", [id]);
		const result = await new MigrationRunner(await MigrationSource.fromDirectory("migrations")).migrate(database);
		expect(result.applied).toEqual([18, 19]);
		expect(await database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mfm_profile_specializations'")).toEqual([]);
		expect(await database.query("SELECT profile_id, event_status, profile_type, location_text, about_text FROM mfm_profiles")).toEqual([{ profile_id: id, event_status: "volunteer", profile_type: "specialist", location_text: "Екатеринбург, Россия", about_text: null }]);
		expect(await database.query("SELECT * FROM mfm_profile_open_to")).toEqual([{ profile_id: id, intent: "joint_projects" }]);
		expect(await database.query("PRAGMA foreign_key_check")).toEqual([]);
	} finally { await database.close(); await rm(directory, { recursive: true, force: true }); }
});
