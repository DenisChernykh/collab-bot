import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	commandReceipts,
	processedUpdates,
	telegramActions,
	telegramUsers,
} from "../../src/infrastructure/database/drizzle-schema.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";

const canonicalMigrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

async function withCanonicalDatabase<T>(work: (boundary: DatabaseBoundary) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s0-04-schema-"));
	const migrationsPath = join(directory, "migrations");
	await mkdir(migrationsPath);
	await copyFile(
		join(canonicalMigrationsPath, "0001_s0-04-ingress-foundation.sql"),
		join(migrationsPath, "0001_s0-04-ingress-foundation.sql"),
	);
	const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
	try {
		const source = await MigrationSource.fromDirectory(migrationsPath);
		const runner = new MigrationRunner(source);
		expect((await runner.migrate(boundary)).applied).toEqual([1]);
		expect((await runner.migrate(boundary)).applied).toEqual([]);
		await runner.verify(boundary);
		return await work(boundary);
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

describe("S0-04 canonical schema", () => {
	it("keeps the exact telegram_users foundation and has no product tables", async () => {
		await withCanonicalDatabase(async (boundary) => {
			const userColumns = await boundary.query<{ name: string }>("PRAGMA table_info(telegram_users)");
			expect(userColumns.map((column) => column.name)).toEqual([
				"telegram_user_id",
				"username",
				"display_name",
				"status",
				"blocked_at",
				"created_at",
				"updated_at",
			]);

			const tables = await boundary.query<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			);
			expect(tables.map((table) => table.name)).toEqual([
				"__app_migrations",
				"command_receipts",
				"processed_updates",
				"telegram_actions",
				"telegram_users",
			]);

			expect(telegramUsers.telegramUserId.name).toBe("telegram_user_id");
			expect(telegramUsers.blockedAt.name).toBe("blocked_at");
			expect(telegramActions.tokenHash.name).toBe("token_hash");
			expect(commandReceipts.inputHash.name).toBe("input_hash");
			expect(processedUpdates.commandId.name).toBe("command_id");
			expect(await boundary.query<{ foreign_keys: number }>("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
		});
	});

	it("enforces identity coherence, callback ownership, receipt state, and update uniqueness", async () => {
		await withCanonicalDatabase(async (boundary) => {
			await boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				["100", "alice", "Alice", "active", null, 0, 0],
			);
			await expect(boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				["200", null, "Blocked", "blocked", null, 0, 0],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				["201", null, "Active", "active", 10, 0, 10],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				["not-decimal", null, "Invalid", "active", null, 0, 0],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				["202", null, "Invalid", "active", null, 10, 9],
			)).rejects.toThrow();

			await boundary.execute(
				"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["a".repeat(64), "100", "foundation.action", "entity-1", 1, "one_shot", 10_000, null, null],
			);
			await expect(boundary.execute(
				"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["a".repeat(64), "100", "foundation.action", "entity-2", null, "reusable", 10_000, null, null],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["b".repeat(64), "999", "foundation.action", "entity-2", null, "reusable", 10_000, null, null],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["b".repeat(64), "100", "foundation.action", "entity-2", null, "reusable", 10_000, 20, '{"version":1}'],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO telegram_actions (token_hash, actor_telegram_user_id, action_type, entity_id, expected_version, mode, expires_at, consumed_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				["c".repeat(64), "100", "foundation.action", "entity-2", null, "one_shot", 10_000, 20, null],
			)).rejects.toThrow();

			await boundary.execute(
				"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["command-1", "telegram", 1, "c".repeat(64), "completed", '{"version":1,"outcome":"ok"}', 0, 1],
			);
			await boundary.execute(
				"INSERT INTO processed_updates (update_id, command_id, processed_at) VALUES (?, ?, ?)",
				[1, "command-1", 1],
			);
			await expect(boundary.execute(
				"INSERT INTO processed_updates (update_id, command_id, processed_at) VALUES (?, ?, ?)",
				[1, "command-1", 2],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO processed_updates (update_id, command_id, processed_at) VALUES (?, ?, ?)",
				[2, "missing-command", 2],
			)).rejects.toThrow();
			await boundary.execute(
				"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["operator-command", "operator", null, "f".repeat(64), "in_progress", null, 0, null],
			);
			await expect(boundary.execute(
				"INSERT INTO processed_updates (update_id, command_id, processed_at) VALUES (?, ?, ?)",
				[2, "operator-command", 2],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO processed_updates (update_id, command_id, processed_at) VALUES (?, ?, ?)",
				[3, "command-1", 3],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["operator-with-update", "operator", 2, "d".repeat(64), "in_progress", null, 0, null],
			)).rejects.toThrow();
			await expect(boundary.execute(
				"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["incomplete-result", "telegram", 3, "e".repeat(64), "in_progress", '{"version":1,"outcome":"ok"}', 0, null],
			)).rejects.toThrow();
		});
	});

	it("upgrades a previous-version fixture with the immutable canonical migration", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s0-04-upgrade-"));
		const migrationsPath = join(directory, "migrations");
		await mkdir(migrationsPath);
		await copyFile(
			join(canonicalMigrationsPath, "0001_s0-04-ingress-foundation.sql"),
			join(migrationsPath, "0001_s0-04-ingress-foundation.sql"),
		);
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		try {
			const firstRunner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), new FakeClock(1234));
			expect((await firstRunner.migrate(boundary)).applied).toEqual([1]);
			expect(await boundary.query<{ applied_at: number }>("SELECT applied_at FROM __app_migrations WHERE id = 1")).toEqual([
				{ applied_at: 1234 },
			]);
			await writeFile(
				join(migrationsPath, "0002_upgrade_fixture.sql"),
				"CREATE TABLE upgrade_fixture (id INTEGER PRIMARY KEY);\n",
				"utf8",
			);
			const upgradeRunner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), new FakeClock(5678));
			expect((await upgradeRunner.migrate(boundary)).applied).toEqual([2]);
			expect((await upgradeRunner.migrate(boundary)).applied).toEqual([]);
			expect(await boundary.query<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'upgrade_fixture'")).toEqual([
				{ name: "upgrade_fixture" },
			]);
			await upgradeRunner.verify(boundary);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
