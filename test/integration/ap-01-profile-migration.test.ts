import { CURRENT_MIGRATION_IDS } from "../support/canonical-migrations.js";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { SqliteCollaborationRepository } from "../../src/modules/collaborations/infrastructure/sqlite-collaboration-repository.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";

it("upgrades populated profiles to nullable type without changing IDs, children or references", async () => {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-ap-01-"));
	const database = new DatabaseBoundary(join(directory, "app.sqlite"));
	try {
		const canonicalPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
		const previousPath = join(directory, "migrations");
		await mkdir(previousPath);
		for (const filename of (await readdir(canonicalPath)).filter((name) => Number(name.slice(0, 4)) <= 13)) {
			await copyFile(join(canonicalPath, filename), join(previousPath, filename));
		}
		await new MigrationRunner(await MigrationSource.fromDirectory(previousPath)).migrate(database);
		await database.execute("INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES ('100', 'example_user', 'Example User', 'active', NULL, 1, 1)");
		const profileId = "11111111-1111-4111-8111-111111111111";
		await database.execute("INSERT INTO profiles (id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at) VALUES (?, '100', 'blogger', 'Custom Name', NULL, 'ekaterinburg', 'active', 1, 1)", [profileId]);
		await database.execute("INSERT INTO profile_platforms (id, profile_id, platform_type, url) VALUES ('22222222-2222-4222-8222-222222222222', ?, 'website', 'https://example.com')", [profileId]);
		await database.execute("INSERT INTO profile_topics VALUES (?, 'city')", [profileId]);
		const collaborations = new SqliteCollaborationRepository(database);
		const beforeCollaboration = await collaborations.createDraft("100", 1);
		const beforeProfile = await database.query("SELECT id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at FROM profiles");
		const beforePlatforms = await database.query("SELECT * FROM profile_platforms");
		const beforeTopics = await database.query("SELECT * FROM profile_topics");
		const runner = new MigrationRunner(await MigrationSource.fromDirectory(canonicalPath));
		expect((await runner.migrate(database)).applied).toEqual(CURRENT_MIGRATION_IDS.filter((id) => id >= 14));
		expect(await database.query("SELECT id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at FROM profiles")).toEqual(beforeProfile);
		expect(await database.query("SELECT * FROM profile_platforms")).toEqual(beforePlatforms);
		expect(await database.query("SELECT * FROM profile_topics")).toEqual(beforeTopics);
		expect(await collaborations.findById(beforeCollaboration.id)).toEqual(beforeCollaboration);
		await database.execute("INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES ('200', NULL, 'Second User', 'active', NULL, 1, 1)");
		await database.execute("INSERT INTO profiles (id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', '200', NULL, 'Second User', NULL, 'ekaterinburg', 'active', 1, 1)");
		await expect(database.execute("UPDATE profiles SET type = 'unknown' WHERE telegram_user_id = '200'")).rejects.toThrow();
		await expect(database.execute("UPDATE profiles SET telegram_user_id = '100' WHERE telegram_user_id = '200'")).rejects.toThrow();
		expect(await database.query("PRAGMA foreign_key_check")).toEqual([]);
		expect(await database.query("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
		expect(await runner.migrate(database)).toEqual({ applied: [], noOp: true });
	} finally {
		await database.close();
		await rm(directory, { recursive: true, force: true });
	}
});
