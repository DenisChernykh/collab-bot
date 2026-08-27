import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DurableCommandExecutor } from "../../src/application/commands/command-executor.js";
import type { CommandContext } from "../../src/application/commands/command-contracts.js";
import type { CanonicalInput } from "../../src/application/commands/canonical-input.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { SqliteProfileRepository } from "../../src/infrastructure/database/profile-repository.js";
import { SqliteProfileSessionRepository } from "../../src/infrastructure/database/profile-session-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import { ProfileService, type ProfileInput } from "../../src/application/profiles/profile-service.js";

const canonicalMigrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

const profileInput: ProfileInput = {
	type: "blogger",
	displayName: "Alice Creator",
	description: "Ищу партнёров для полезных городских проектов.",
	topics: ["lifestyle", "city"],
	platforms: [{ platformType: "website", url: "https://example.com/alice", audienceSize: 0 }],
};

async function withDatabase<T>(work: (boundary: DatabaseBoundary, databasePath: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-01-profile-"));
	const databasePath = join(directory, "app.sqlite");
	const boundary = new DatabaseBoundary(databasePath);
	try {
		const source = await MigrationSource.fromDirectory(canonicalMigrationsPath);
		await new MigrationRunner(source, new FakeClock(1_700_000_000_000)).migrate(boundary);
		return await work(boundary, databasePath);
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

async function seedUser(boundary: DatabaseBoundary, telegramUserId: string): Promise<void> {
	await boundary.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
		[telegramUserId, "alice", "Alice", 1_700_000_000_000, 1_700_000_000_000],
	);
}

function createService(boundary: DatabaseBoundary, clock = new FakeClock(1_700_000_000_000)): ProfileService {
	return new ProfileService(
		new SqliteProfileRepository(boundary),
		new DatabaseBoundaryTransactionRunner(boundary),
		clock,
	);
}

describe("S1-01 profile state and privacy boundary", () => {
	it("applies the profile migration and enforces the one-active-profile schema boundary", async () => {
		await withDatabase(async (boundary) => {
			const tables = await boundary.query<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('profiles', 'profile_platforms', 'profile_topics') ORDER BY name",
			);
			expect(tables.map((row) => row.name)).toEqual([
				"profile_platforms",
				"profile_topics",
				"profiles",
			]);
			expect(await boundary.query<{ name: string }>("PRAGMA table_info(profiles)")).not.toContainEqual(expect.objectContaining({ name: "private_contact" }));
			const indexes = await boundary.query<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'profiles_one_active_per_user'",
			);
			expect(indexes).toEqual([{ name: "profiles_one_active_per_user" }]);

			await seedUser(boundary, "100");
			const service = createService(boundary);
			await service.create("100", profileInput);
			await expect(service.create("100", profileInput)).rejects.toThrow(/active profile/i);
			await expect(boundary.execute(
				"INSERT INTO profiles (id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["11111111-1111-4111-8111-111111111111", "100", "blogger", "Archived", "Архивное описание профиля", "ekaterinburg", "archived", 2, 2],
			)).resolves.toMatchObject({ changes: 1 });
		});
	});

	it("creates, reads and edits a public profile without collecting a private contact", async () => {
		await withDatabase(async (boundary) => {
			const telegramUserId = "900719925474099312345";
			await seedUser(boundary, telegramUserId);
			const service = createService(boundary);

			const created = await service.create(telegramUserId, profileInput);
			expect(created.telegramUserId).toBe(telegramUserId);
			expect(created).not.toHaveProperty("privateContact");

			const publicView = await service.getPublic(created.id);
			expect(publicView).toBeDefined();
			expect(publicView).not.toHaveProperty("privateContact");
			expect(publicView).not.toHaveProperty("telegramUserId");
			expect(publicView?.platforms).toHaveLength(1);
			expect(publicView?.topics).toEqual(["city", "lifestyle"]);

			const updated = await service.update(telegramUserId, {
				...profileInput,
				type: "venue_or_brand",
				displayName: "Alice Studio",
			});
			expect(updated.displayName).toBe("Alice Studio");
			expect((await service.getPublic(created.id))).not.toHaveProperty("privateContact");
			expect((await service.getPublic(created.id))).not.toHaveProperty("telegramUserId");
		});
	});

	it("creates and persists a minimal profile and clears optional enrichment on update", async () => {
		await withDatabase(async (boundary, databasePath) => {
			await seedUser(boundary, "100");
			const service = createService(boundary);
			const minimal: ProfileInput = {
				type: "blogger",
				displayName: "Minimal Creator",
				description: null,
				topics: [],
				platforms: [{ platformType: "website", url: "https://example.com/minimal" }],
			};

			const created = await service.create("100", minimal);
			expect(created).toMatchObject({ description: null, topics: [], platforms: [{ url: "https://example.com/minimal" }] });
			expect(await service.getPublic(created.id)).toMatchObject({ description: null, topics: [] });

			await service.update("100", profileInput);
			const cleared = await service.update("100", minimal);
			expect(cleared).toMatchObject({ description: null, topics: [] });
			expect(await boundary.query("SELECT description FROM profiles WHERE id = ?", [created.id])).toEqual([{ description: null }]);
			expect(await boundary.query("SELECT topic FROM profile_topics WHERE profile_id = ?", [created.id])).toEqual([]);
			await boundary.close();
			const reopened = new DatabaseBoundary(databasePath);
			try {
				expect(await new SqliteProfileRepository(reopened).findActiveByTelegramUserId("100")).toMatchObject({ id: created.id, description: null, topics: [] });
			} finally {
				await reopened.close();
			}
		});
	});

	it("replays a duplicate Telegram command without creating a second profile", async () => {
		await withDatabase(async (boundary) => {
			await seedUser(boundary, "100");
			const clock = new FakeClock(1_700_000_000_000);
			const service = createService(boundary, clock);
			const commandStore = new SqliteDurableCommandStore(boundary);
			const input = { operation: "create_profile", telegramUserId: "100", profile: profileInput } as unknown as CanonicalInput;
			const executor = new DurableCommandExecutor(
				new DatabaseBoundaryTransactionRunner(boundary),
				commandStore,
				{ hash: hashCanonicalInput },
				clock,
			);
			const context: CommandContext = {
				commandId: "telegram:update:1001",
				telegramUpdateId: 1001,
				actor: { kind: "telegram_user", telegramUserId: "100" },
				occurredAt: clock.now(),
			};

			const effect = async () => {
				const profile = await service.create("100", profileInput);
				return { version: 1 as const, outcome: "completed" as const, entityId: profile.id };
			};
			const first = await executor.execute({ context, input, effect });
			const second = await executor.execute({ context, input, effect });
			expect(second).toEqual(first);
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM profiles WHERE status = 'active'")).toEqual([{ count: 1 }]);
		});
	});

	it("keeps the profile after closing and reopening the SQLite boundary", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-01-restart-"));
		const databasePath = join(directory, "app.sqlite");
		try {
			const source = await MigrationSource.fromDirectory(canonicalMigrationsPath);
			const firstBoundary = new DatabaseBoundary(databasePath);
			await new MigrationRunner(source, new FakeClock(1_700_000_000_000)).migrate(firstBoundary);
			await seedUser(firstBoundary, "100");
			const created = await createService(firstBoundary).create("100", profileInput);
			await firstBoundary.close();

			const secondBoundary = new DatabaseBoundary(databasePath);
			try {
				await expect(new MigrationRunner(source).migrate(secondBoundary)).resolves.toMatchObject({ noOp: true });
				expect(await createService(secondBoundary).getOwn("100")).toMatchObject({ id: created.id });
				expect(await createService(secondBoundary).getOwn("100")).not.toHaveProperty("privateContact");
			} finally {
				await secondBoundary.close();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("upgrades a S1-02 database without private contact and preserves profile and session data", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-03-contactless-upgrade-"));
		const migrationsPath = join(directory, "migrations");
		const databasePath = join(directory, "app.sqlite");
		const boundary = new DatabaseBoundary(databasePath);
		try {
			await mkdir(migrationsPath);
			for (const filename of [
				"0001_s0-04-ingress-foundation.sql",
				"0002_s0-05-outbox-events.sql",
				"0003_s1-01-profile-state.sql",
				"0004_s1-02-profile-sessions.sql",
			]) {
				await copyFile(join(canonicalMigrationsPath, filename), join(migrationsPath, filename));
			}
			const previousSource = await MigrationSource.fromDirectory(migrationsPath);
			expect((await new MigrationRunner(previousSource).migrate(boundary)).applied).toEqual([1, 2, 3, 4]);
			for (const [telegramUserId, username, displayName] of [["100", "alice", "Alice"], ["101", "bob", "Bob"]] as const) {
				await boundary.execute(
					"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
					[telegramUserId, username, displayName, 1_700_000_000_000, 1_700_000_000_000],
				);
			}
			await boundary.execute(
				"INSERT INTO profiles (id, telegram_user_id, type, display_name, description, city_code, private_contact, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["11111111-1111-4111-8111-111111111111", "100", "blogger", "Alice", "Городской профиль", "ekaterinburg", "@old_contact", "active", 1_700_000_000_000, 1_700_000_000_000],
			);
			await boundary.execute(
				"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111", "telegram", "https://t.me/alice_channel", "Alice Channel", "alice_channel", "-100123", 42],
			);
			await boundary.execute(
				"INSERT INTO profile_topics (profile_id, topic) VALUES (?, ?)",
				["11111111-1111-4111-8111-111111111111", "city"],
			);
			await boundary.execute(
				"INSERT INTO profile_sessions (telegram_user_id, flow_type, step, state_json, revision, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				[
					"100",
					"profile",
					"private_contact",
					JSON.stringify({
						version: 1,
						generation: "aaaaaaaaaaaaaaaa",
						step: "private_contact",
						draft: {
							type: "blogger",
							displayName: "Alice",
							description: "Городской профиль для старого сеанса.",
							topics: ["city"],
							platform: { platformType: "website", url: "https://example.com/alice" },
							privateContact: "@legacy_alice",
						},
						requestId: 7,
					}),
					3,
					1_700_000_100_000,
					1_700_000_000_000,
				],
			);
			await boundary.execute(
				"INSERT INTO profile_sessions (telegram_user_id, flow_type, step, state_json, revision, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				[
					"101",
					"profile",
					"review",
					JSON.stringify({
						version: 1,
						generation: "bbbbbbbbbbbbbbbb",
						step: "review",
						draft: {
							type: "venue_or_brand",
							displayName: "Bob",
							description: "Городской профиль для проверки review.",
							topics: ["business"],
							platform: { platformType: "website", url: "https://example.com/bob" },
							privateContact: "@legacy_bob",
						},
						requestId: -1,
					}),
					4,
					1_700_000_100_000,
					1_700_000_000_000,
				],
			);
			await copyFile(join(canonicalMigrationsPath, "0005_s1-03-telegram-first-contact.sql"), join(migrationsPath, "0005_s1-03-telegram-first-contact.sql"));
			const upgradedSource = await MigrationSource.fromDirectory(migrationsPath);
			expect((await new MigrationRunner(upgradedSource).migrate(boundary)).applied).toEqual([5]);
			await expect(new MigrationRunner(upgradedSource).verify(boundary)).resolves.toBeUndefined();
			expect(await boundary.query<{ name: string }>("PRAGMA table_info(profiles)")).not.toContainEqual(expect.objectContaining({ name: "private_contact" }));
			expect(await boundary.query("SELECT id, display_name, city_code, status FROM profiles")).toEqual([{
				id: "11111111-1111-4111-8111-111111111111",
				display_name: "Alice",
				city_code: "ekaterinburg",
				status: "active",
			}]);
			expect(await boundary.query("SELECT platform_type, url, title, username, telegram_chat_id, audience_size FROM profile_platforms")).toEqual([{
				platform_type: "telegram",
				url: "https://t.me/alice_channel",
				title: "Alice Channel",
				username: "alice_channel",
				telegram_chat_id: "-100123",
				audience_size: 42,
			}]);
			expect(await boundary.query("SELECT profile_id, topic FROM profile_topics")).toEqual([{ profile_id: "11111111-1111-4111-8111-111111111111", topic: "city" }]);
			expect(await boundary.query("SELECT telegram_user_id, flow_type, step, revision FROM profile_sessions ORDER BY telegram_user_id")).toEqual([
				{ telegram_user_id: "100", flow_type: "profile", step: "review", revision: 3 },
				{ telegram_user_id: "101", flow_type: "profile", step: "review", revision: 4 },
			]);
			await boundary.close();

			const reopened = new DatabaseBoundary(databasePath);
			try {
				expect(await new MigrationRunner(upgradedSource).migrate(reopened)).toMatchObject({ applied: [], noOp: true });
				await expect(new MigrationRunner(upgradedSource).verify(reopened)).resolves.toBeUndefined();
				const sessions = new SqliteProfileSessionRepository(reopened);
				const migratedPrivateContact = await sessions.findActive("100", 1_700_000_000_000);
				const migratedReview = await sessions.findActive("101", 1_700_000_000_000);
				expect(migratedPrivateContact).toMatchObject({
					revision: 3,
					expiresAt: 1_700_000_100_000,
					updatedAt: 1_700_000_000_000,
					state: { generation: "aaaaaaaaaaaaaaaa", step: "review", requestId: 7 },
				});
				expect(migratedPrivateContact?.state.draft).not.toHaveProperty("privateContact");
				expect(migratedReview).toMatchObject({
					revision: 4,
					state: { generation: "bbbbbbbbbbbbbbbb", step: "review", requestId: -1 },
				});
				expect(migratedReview?.state.draft).not.toHaveProperty("privateContact");
				expect(await reopened.query("SELECT telegram_user_id, step, json_extract(state_json, '$.step') AS json_step, json_extract(state_json, '$.draft.privateContact') AS private_contact FROM profile_sessions ORDER BY telegram_user_id")).toEqual([
					{ telegram_user_id: "100", step: "review", json_step: "review", private_contact: null },
					{ telegram_user_id: "101", step: "review", json_step: "review", private_contact: null },
				]);
				const migratedProfile = await createService(reopened).getOwn("100");
				expect(migratedProfile).toMatchObject({
					displayName: "Alice",
					platforms: [{ url: "https://t.me/alice_channel", audienceSize: 42 }],
					topics: ["city"],
				});
				expect(migratedProfile).not.toHaveProperty("privateContact");
			} finally {
				await reopened.close();
			}
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("supports a previous-version fixture upgrading with only S1-01 migration", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-01-upgrade-"));
		const migrationsPath = join(directory, "migrations");
		await mkdir(migrationsPath);
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		try {
			for (const filename of ["0001_s0-04-ingress-foundation.sql", "0002_s0-05-outbox-events.sql"]) {
				await copyFile(join(canonicalMigrationsPath, filename), join(migrationsPath, filename));
			}
			const previousSource = await MigrationSource.fromDirectory(migrationsPath);
			expect((await new MigrationRunner(previousSource).migrate(boundary)).applied).toEqual([1, 2]);
			await copyFile(join(canonicalMigrationsPath, "0003_s1-01-profile-state.sql"), join(migrationsPath, "0003_s1-01-profile-state.sql"));
			const upgradedSource = await MigrationSource.fromDirectory(migrationsPath);
			expect((await new MigrationRunner(upgradedSource).migrate(boundary)).applied).toEqual([3]);
			await expect(new MigrationRunner(upgradedSource).verify(boundary)).resolves.toBeUndefined();
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("upgrades 0007 to nullable description without changing dependent profile data", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-01-minimal-profile-upgrade-"));
		const migrationsPath = join(directory, "migrations");
		const databasePath = join(directory, "app.sqlite");
		await mkdir(migrationsPath);
		let boundary = new DatabaseBoundary(databasePath);
		try {
			for (const filename of [
				"0001_s0-04-ingress-foundation.sql",
				"0002_s0-05-outbox-events.sql",
				"0003_s1-01-profile-state.sql",
				"0004_s1-02-profile-sessions.sql",
				"0005_s1-03-telegram-first-contact.sql",
				"0006_s2-01-collaboration-drafts.sql",
				"0007_s2-02-channel-publications.sql",
			]) await copyFile(join(canonicalMigrationsPath, filename), join(migrationsPath, filename));
			const previousSource = await MigrationSource.fromDirectory(migrationsPath);
			expect((await new MigrationRunner(previousSource).migrate(boundary)).applied).toEqual([1, 2, 3, 4, 5, 6, 7]);
			await seedUser(boundary, "100");
			await boundary.execute(
				"INSERT INTO profiles (id, telegram_user_id, type, display_name, description, city_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["11111111-1111-4111-8111-111111111111", "100", "blogger", "Existing Creator", "Existing profile description", "ekaterinburg", "active", 1, 1],
			);
			await boundary.execute(
				"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111", "telegram", "https://t.me/existing_channel", "Existing", "existing_channel", "-100123", 42],
			);
			await boundary.execute("INSERT INTO profile_topics (profile_id, topic) VALUES (?, ?)", ["11111111-1111-4111-8111-111111111111", "city"]);
			await boundary.execute(
				"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["33333333-3333-4333-8333-333333333333", "abcdefghijklmnopqrstuv", "11111111-1111-4111-8111-111111111111", "joint_content", "any", "Existing card", "Existing collaboration offer", "Existing partner expectation", 1, 1_800_000_000_000, null, "ekaterinburg", "published", 1, 0, 1, 1],
			);
			await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, ?)", ["33333333-3333-4333-8333-333333333333", "city"]);
			await boundary.execute(
				"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
				["33333333-3333-4333-8333-333333333333", "-1001", 10, "published", 1, 0, "a".repeat(64), 1, 1],
			);

			await copyFile(join(canonicalMigrationsPath, "0008_s3-01-minimal-profiles.sql"), join(migrationsPath, "0008_s3-01-minimal-profiles.sql"));
			const upgradedSource = await MigrationSource.fromDirectory(migrationsPath);
			expect((await new MigrationRunner(upgradedSource).migrate(boundary)).applied).toEqual([8]);
			await expect(new MigrationRunner(upgradedSource).verify(boundary)).resolves.toBeUndefined();
			expect(await boundary.query("SELECT id, description FROM profiles")).toEqual([{ id: "11111111-1111-4111-8111-111111111111", description: "Existing profile description" }]);
			expect(await boundary.query("SELECT id, profile_id, audience_size FROM profile_platforms")).toEqual([{ id: "22222222-2222-4222-8222-222222222222", profile_id: "11111111-1111-4111-8111-111111111111", audience_size: 42 }]);
			expect(await boundary.query("SELECT profile_id, topic FROM profile_topics")).toEqual([{ profile_id: "11111111-1111-4111-8111-111111111111", topic: "city" }]);
			expect(await boundary.query("SELECT id, author_profile_id FROM collaborations")).toEqual([{ id: "33333333-3333-4333-8333-333333333333", author_profile_id: "11111111-1111-4111-8111-111111111111" }]);
			expect(await boundary.query("PRAGMA foreign_key_check")).toEqual([]);
			expect(await boundary.query<{ notnull: number }>("PRAGMA table_info(profiles)")).toContainEqual(expect.objectContaining({ name: "description", notnull: 0 }));
			expect(await boundary.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'profiles_one_active_per_user'")).toEqual([{ name: "profiles_one_active_per_user" }]);
			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await expect(new MigrationRunner(upgradedSource).migrate(boundary)).resolves.toMatchObject({ noOp: true });
			expect(await new SqliteProfileRepository(boundary).findActiveByTelegramUserId("100")).toMatchObject({ description: "Existing profile description", topics: ["city"] });
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
