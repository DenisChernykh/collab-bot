import { fileURLToPath } from "node:url";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { DurableCommandExecutor } from "../../src/application/commands/command-executor.js";
import { ProfileService } from "../../src/application/profiles/profile-service.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { SqliteProfileRepository } from "../../src/infrastructure/database/profile-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { SqliteProfileSessionRepository } from "../../src/infrastructure/database/profile-session-repository.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import type { ProfileSessionState } from "../../src/application/ports/profile-session-repository.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("S1-02 durable profile sessions", () => {
	it("upgrades a previous S1-01 database with only the session migration", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-upgrade-"));
		const fixtureMigrations = join(directory, "migrations");
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		try {
			await mkdir(fixtureMigrations);
			for (const filename of ["0001_s0-04-ingress-foundation.sql", "0002_s0-05-outbox-events.sql", "0003_s1-01-profile-state.sql"]) {
				await copyFile(join(migrationsPath, filename), join(fixtureMigrations, filename));
			}
			const previous = await MigrationSource.fromDirectory(fixtureMigrations);
			expect((await new MigrationRunner(previous).migrate(boundary)).applied).toEqual([1, 2, 3]);
			await copyFile(join(migrationsPath, "0004_s1-02-profile-sessions.sql"), join(fixtureMigrations, "0004_s1-02-profile-sessions.sql"));
			const upgraded = await MigrationSource.fromDirectory(fixtureMigrations);
			expect((await new MigrationRunner(upgraded).migrate(boundary)).applied).toEqual([4]);
			await expect(new MigrationRunner(upgraded).verify(boundary)).resolves.toBeUndefined();
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("persists a versioned session across close/reopen and expires old sessions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-session-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const state: ProfileSessionState = {
			version: 1,
			generation: "0123456789abcdef",
			step: "display_name",
			draft: { type: "blogger" },
		};
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			const first = new DatabaseBoundary(databasePath);
			await new MigrationRunner(source, clock).migrate(first);
			await first.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
				["900719925474099312345", "alice", "Alice", clock.now().getTime(), clock.now().getTime()],
			);
			const repository = new SqliteProfileSessionRepository(first);
			await repository.save({
				telegramUserId: "900719925474099312345",
				state,
				revision: 1,
				expiresAt: clock.now().getTime() + 30 * 24 * 60 * 60 * 1000,
				updatedAt: clock.now().getTime(),
			});
			await first.close();

			const second = new DatabaseBoundary(databasePath);
			try {
				const reopened = new SqliteProfileSessionRepository(second);
				expect(await reopened.findActive("900719925474099312345", clock.now().getTime())).toMatchObject({
					revision: 1,
					state,
				});
				clock.advanceBy(31 * 24 * 60 * 60 * 1000);
				expect(await reopened.findActive("900719925474099312345", clock.now().getTime())).toBeUndefined();
			} finally {
				await second.close();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("rolls back profile and durable receipt when session cleanup fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-rollback-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			await boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, 'active', NULL, ?, ?)",
				["901", "alice", "Alice", clock.now().getTime(), clock.now().getTime()],
			);
			const profileService = new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock);
			const executor = new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
			await expect(executor.execute({
				context: { commandId: "telegram:update:901", telegramUpdateId: 901, actor: { kind: "telegram_user", telegramUserId: "901" }, occurredAt: new Date(1_700_000_000_000) },
				input: { kind: "profile.apply", profile: { type: "blogger", displayName: "Alice", description: "A useful local profile.", topics: ["city"], platform: { platformType: "website", url: "https://example.com/alice" } } },
				effect: async () => {
					await profileService.create("901", { type: "blogger", displayName: "Alice", description: "A useful local profile.", topics: ["city"], platforms: [{ platformType: "website", url: "https://example.com/alice" }] });
					throw new Error("session cleanup failed");
				},
			})).rejects.toThrow("session cleanup failed");
			expect(await profileService.getOwn("901")).toBeUndefined();
			expect(await boundary.query("SELECT command_id FROM command_receipts WHERE command_id = ?", ["telegram:update:901"])).toEqual([]);
			expect(await boundary.query("SELECT update_id FROM processed_updates WHERE update_id = ?", [901])).toEqual([]);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
