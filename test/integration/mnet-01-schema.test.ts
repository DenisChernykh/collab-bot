import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";
import { NodeSqlDatabase } from "../../src/platform/database/node-sql-database.js";
import { exportStateTransferManifest, importStateTransferManifest } from "../../src/platform/database/state-transfer.js";

it("upgrades populated schema15 without opt-in, enforces pair decisions and transfers introductions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "mnet-upgrade-"));
	const source = new DatabaseBoundary(join(directory, "source.sqlite"));
	const target = new DatabaseBoundary(join(directory, "target.sqlite"));
	const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
	try {
		const legacy = join(directory, "legacy"); await mkdir(legacy);
		for (const name of await readdir("migrations")) if (Number(name.slice(0, 4)) <= 15) await copyFile(join("migrations", name), join(legacy, name));
		await new MigrationRunner(await MigrationSource.fromDirectory(legacy)).migrate(source);
		for (const [i, id] of ids.entries()) {
			await source.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, experience, preferred_language, created_at, updated_at) VALUES (?, 'Synthetic person', 'active', ?, 'en', 1, 1)", [String(i + 1), i < 2 ? "mfm" : "classic"]);
			await source.execute("INSERT INTO profiles (id, telegram_user_id, display_name, type, city_code, status, created_at, updated_at) VALUES (?, ?, 'Saved person', NULL, 'ekaterinburg', 'active', 1, 1)", [id, String(i + 1)]);
			if (i < 2) {
				await source.execute("INSERT INTO mfm_profiles VALUES (?, 'volunteer', 'specialist', 'Synthetic City', 2, 2, 1)", [id]);
				await source.execute("INSERT INTO mfm_profile_spheres VALUES (?, 'digital_it')", [id]);
				await source.execute("INSERT INTO mfm_profile_specializations VALUES (?, 'digital_it', 'ai')", [id]);
				await source.execute("INSERT INTO mfm_profile_open_to VALUES (?, 'joint_projects')", [id]);
			}
		}
		const before = await source.query("SELECT * FROM profiles");
		const beforeMfm = await source.query("SELECT * FROM mfm_profiles");
		const runner = new MigrationRunner(await MigrationSource.fromDirectory("migrations"));
		expect((await runner.migrate(source)).applied).toEqual([16, 17]);
		expect(await source.query("SELECT * FROM profiles")).toEqual(before);
		expect(await source.query("SELECT * FROM mfm_profiles")).toEqual(beforeMfm);
		expect(await source.query("SELECT * FROM mfm_discovery_settings")).toEqual([]);
		await source.execute("INSERT INTO mfm_discovery_settings VALUES (?, 1, 1, 3)", [ids[0]!]);
		const insert = "INSERT INTO introduction_requests (id, public_token, sender_profile_id, recipient_profile_id, message, status, revision, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 1, 3)";
		const requestId = "20000000-0000-4000-8000-000000000001";
		await source.execute(insert, [requestId, "A".repeat(22), ids[0]!, ids[1]!, "Let us meet at the event"]);
		await expect(source.execute(insert, ["20000000-0000-4000-8000-000000000002", "B".repeat(22), ids[1]!, ids[0]!, "Reverse introduction message"])).rejects.toThrow();
		await expect(source.execute(insert, ["20000000-0000-4000-8000-000000000003", "C".repeat(22), ids[0]!, ids[0]!, "Self introduction message"])).rejects.toThrow();
		await expect(source.execute(insert, ["20000000-0000-4000-8000-000000000004", "D".repeat(22), ids[0]!, ids[2]!, "Classic cannot join here"])).rejects.toThrow();
		await expect(source.execute("UPDATE introduction_requests SET status = 'accepted' WHERE id = ?", [requestId])).rejects.toThrow();
		await source.execute("UPDATE introduction_requests SET status = 'accepted', revision = 2, decided_at = 4 WHERE id = ?", [requestId]);
		await expect(source.execute("UPDATE introduction_requests SET status = 'rejected', revision = 3 WHERE id = ?", [requestId])).rejects.toThrow();
		await source.execute("INSERT INTO connection_sessions VALUES ('1', '{\"version\":1,\"message\":\"Saved draft\"}', 1, 4)");
		await runner.verify(source);
		await runner.migrate(target);
		const targetDb = new NodeSqlDatabase(target);
		await targetDb.execute("CREATE TABLE cf1_state_import_audit (id INTEGER PRIMARY KEY CHECK (id = 1), digest TEXT NOT NULL, imported_at INTEGER NOT NULL)");
		const exported = await exportStateTransferManifest(new NodeSqlDatabase(source));
		expect(exported.schemaVersion).toBe(17);
		expect(exported.tables).toHaveLength(26);
		await importStateTransferManifest(targetDb, exported);
		expect((await exportStateTransferManifest(targetDb)).digest).toBe(exported.digest);
		expect(await target.query("SELECT status, revision FROM introduction_requests")).toEqual([{ status: "accepted", revision: 2 }]);
		expect(await target.query("SELECT visible FROM mfm_discovery_settings")).toEqual([{ visible: 1 }]);
		expect(await target.query("PRAGMA foreign_key_check")).toEqual([]);
		expect((await runner.migrate(source)).noOp).toBe(true);
	} finally { await source.close(); await target.close(); await rm(directory, { recursive: true, force: true }); }
});
