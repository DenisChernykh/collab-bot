import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";
import { NodeSqlDatabase } from "../../src/platform/database/node-sql-database.js";
import { importStateTransferManifest, STATE_TRANSFER_AUDIT_TABLE } from "../../src/platform/database/state-transfer.js";
import { expect, it } from "vitest";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { validateMfmProfile } from "../../src/modules/profiles/domain/mfm-profile.js";
import { withFreshMigratedDatabase } from "../support/migrated-database.js";
import { FakeClock } from "../support/fake-clock.js";
import { exportStateTransferManifest } from "../../src/platform/database/state-transfer.js";

it("persists a confirmed photo separately from the preview and clears it without changing identity", async () => {
 await withFreshMigratedDatabase({ prefix: "mph-photo-", clock: new FakeClock(100) }, async ({ boundary }) => {
  await boundary.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, created_at, updated_at) VALUES ('1', 'Synthetic', 'active', 1, 1)");
  const base = await new SqliteProfileRepository(boundary).createInitial("1", "Synthetic", 1);
  const repo = new SqliteOnboardingRepository(boundary);
  await repo.setUser("1", "ru", "mfm");
  const photo = { fileId: "synthetic_photo", botId: "123" };
  const input = validateMfmProfile({ eventStatus: "participant", displayName: "Synthetic", profileType: "specialist", locationText: "City", spheres: ["media"], openTo: ["joint_projects"], photo });
  expect(input).toMatchObject({ photo });
  await repo.saveProfile("1", input, 2);
  expect(await new SqliteOnboardingRepository(boundary).getProfile("1")).toMatchObject({ photo, profileId: base.id });
  const draft = await repo.saveSession("1", { version: 1, generation: "a".repeat(16), step: "about", draft: input, editing: true, photoOnly: true, photoCandidate: { fileId: "candidate", botId: "123" } }, 3);
  expect(await new SqliteOnboardingRepository(boundary).getSession("1")).toEqual(draft);
  expect(await repo.getProfile("1")).toMatchObject({ photo });
  expect((await exportStateTransferManifest(boundary)).schemaVersion).toBe(19);
  await expect(boundary.execute("UPDATE mfm_profiles SET photo_json = '{}' ")).rejects.toThrow();
  const cleared = await repo.saveProfile("1", { ...input, photo: null }, 3);
  expect(cleared).toMatchObject({ photo: null, profileId: base.id });
  expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);
 });
});

it("upgrades populated schema18 and round-trips photo media through schema19 transfer", async () => {
 const directory = await mkdtemp(join(tmpdir(), "mph-upgrade-"));
 const source = new DatabaseBoundary(join(directory, "source.sqlite"));
 const target = new DatabaseBoundary(join(directory, "target.sqlite"));
 try {
  const legacy = join(directory, "legacy"); await mkdir(legacy);
  for (const name of await readdir("migrations")) if (Number(name.slice(0, 4)) <= 18) await copyFile(join("migrations", name), join(legacy, name));
  await new MigrationRunner(await MigrationSource.fromDirectory(legacy)).migrate(source);
  await source.execute("INSERT INTO telegram_users (telegram_user_id, display_name, status, experience, created_at, updated_at) VALUES ('19', 'Synthetic', 'active', 'mfm', 1, 1)");
  const base = await new SqliteProfileRepository(source).createInitial("19", "Synthetic", 1);
  await source.execute("INSERT INTO mfm_profiles (profile_id, event_status, profile_type, location_text, completed_at, updated_at, revision) VALUES (?, 'participant', 'media', 'City', 2, 2, 1)", [base.id]);
  const before = await source.query<Record<string, unknown>>("SELECT * FROM mfm_profiles");
  const runner = new MigrationRunner(await MigrationSource.fromDirectory("migrations"));
  expect((await runner.migrate(source)).applied).toEqual([19]);
  expect(await source.query("SELECT * FROM mfm_profiles")).toEqual(before.map(row => ({ ...row, photo_json: null })));
  await source.execute("UPDATE mfm_profiles SET photo_json = ?", [JSON.stringify({ fileId: "synthetic_file", botId: "123" })]);
  await runner.migrate(target);
  await target.execute(`CREATE TABLE ${STATE_TRANSFER_AUDIT_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), digest TEXT NOT NULL, imported_at INTEGER NOT NULL)`);
  const manifest = await exportStateTransferManifest(new NodeSqlDatabase(source));
  await importStateTransferManifest(new NodeSqlDatabase(target), manifest);
  expect((await exportStateTransferManifest(new NodeSqlDatabase(target))).digest).toBe(manifest.digest);
  expect(await target.query("SELECT * FROM mfm_profiles")).toEqual(await source.query("SELECT * FROM mfm_profiles"));
 } finally { await source.close(); await target.close(); await rm(directory, { recursive: true, force: true }); }
});
