import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";

it.each([13, 14])("preserves populated schema %i and adds durable, related MFM data", async (version) => {
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
		expect((await runner.migrate(database)).applied).toContain(15);
		expect(await database.query("SELECT * FROM profiles")).toEqual(before);
		expect(await database.query("SELECT experience, preferred_language FROM telegram_users")).toEqual([{ experience: "classic", preferred_language: null }]);
		await database.execute("INSERT INTO mfm_profiles VALUES (?, 'volunteer', 'specialist', 'São Paulo, Brazil', 2, 2, 1)", [id]);
		await expect(database.execute("INSERT INTO mfm_profile_specializations VALUES (?, 'media', 'blogger')", [id])).rejects.toThrow();
		await database.execute("INSERT INTO mfm_profile_spheres VALUES (?, 'media')", [id]);
		await database.execute("INSERT INTO mfm_profile_specializations VALUES (?, 'media', 'blogger')", [id]);
		await database.execute("INSERT INTO mfm_profile_open_to VALUES (?, 'joint_projects')", [id]);
		await expect(database.execute("INSERT INTO mfm_profile_spheres VALUES (?, 'media')", [id])).rejects.toThrow();
		await expect(database.execute("INSERT INTO mfm_profile_open_to VALUES (?, 'anything')", [id])).rejects.toThrow();
		expect(await database.query("PRAGMA foreign_key_check")).toEqual([]);
		expect(await database.query("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
		expect((await runner.migrate(database)).applied).toEqual([]);
	} finally { await database.close(); await rm(directory, { recursive: true, force: true }); }
});
