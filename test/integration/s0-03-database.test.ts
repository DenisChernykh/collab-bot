import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	DatabaseBoundary,
	TransactionRollbackOnlyError,
} from "../../src/infrastructure/database/database-boundary.js";
import {
	MigrationRunner,
	MigrationSource,
} from "../../src/infrastructure/database/migrations.js";

async function temporaryDatabase(): Promise<{
	directory: string;
	databasePath: string;
	migrationsPath: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s0-03-"));
	const migrationsPath = join(directory, "migrations");
	await mkdir(migrationsPath);
	return { directory, databasePath: join(directory, "database.sqlite"), migrationsPath };
}

async function writeMigration(directory: string, filename: string, sql: string): Promise<void> {
	await writeFile(join(directory, filename), `${sql.trim()}\n`, "utf8");
}

async function withFreshDatabase<T>(work: (fixture: Awaited<ReturnType<typeof temporaryDatabase>>) => Promise<T>): Promise<T> {
	const fixture = await temporaryDatabase();
	try {
		return await work(fixture);
	} finally {
		await rm(fixture.directory, { recursive: true, force: true });
	}
}

describe("fresh migration", () => {
	it("bootstraps ordered migrations, configures pragmas, and repeats as a no-op", async () => {
		await withFreshDatabase(async ({ directory, databasePath, migrationsPath }) => {
			await writeMigration(
				migrationsPath,
				"0001_parent.sql",
				"CREATE TABLE parent (id INTEGER PRIMARY KEY);",
			);
			await writeMigration(
				migrationsPath,
				"0002_child.sql",
				"CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));",
			);

			const source = await MigrationSource.fromDirectory(migrationsPath);
			const boundary = new DatabaseBoundary(databasePath);
			try {
				await boundary.withClient(async (context) => {
					context.client.exec("CREATE TABLE raw_sql_probe (id INTEGER PRIMARY KEY)");
					context.client.exec("CREATE TABLE raw_sql_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
					const runResult = context.client
						.prepare("INSERT INTO raw_sql_records (id, label) VALUES (?, ?)")
						.run(1, "alpha");
					expect(runResult).toEqual({ changes: 1, lastInsertRowid: 1 });
					expect(context.client.prepare("SELECT id, label FROM raw_sql_records ORDER BY id").all()).toEqual([
						{ id: 1, label: "alpha" },
					]);
					expect(context.client.prepare("SELECT id, label FROM raw_sql_records WHERE id = ?").get(1)).toEqual({
						id: 1,
						label: "alpha",
					});
					expect(context.client.prepare("SELECT id, label FROM raw_sql_records WHERE id = ?").get(999)).toBeUndefined();
					const values = context.client.prepare("SELECT id, label FROM raw_sql_records ORDER BY id");
					values.setReturnArrays(true);
					expect(values.all()).toEqual([[1, "alpha"]]);
				});
				expect(await boundary.query<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'raw_sql_probe'")).toEqual([
					{ name: "raw_sql_probe" },
				]);
				await expect(boundary.withTransaction(async ({ client }) => {
					client.prepare("INSERT INTO raw_sql_records (id, label) VALUES (?, ?)").run(2, "rolled-back");
					throw new Error("SQLite transaction rollback");
				})).rejects.toThrow("SQLite transaction rollback");
				expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM raw_sql_records")).toEqual([{ count: 1 }]);
				const order: number[] = [];
				await Promise.all([
					boundary.withClient(async ({ client }) => {
						order.push(1);
						client.prepare("INSERT INTO raw_sql_records (id, label) VALUES (?, ?)").run(3, "fifo-a");
						await new Promise((resolve) => setTimeout(resolve, 5));
						order.push(2);
					}),
					boundary.withClient(async ({ client }) => {
						order.push(3);
						client.prepare("INSERT INTO raw_sql_records (id, label) VALUES (?, ?)").run(4, "fifo-b");
					}),
				]);
				expect(order).toEqual([1, 2, 3]);
				const runner = new MigrationRunner(source);
				expect((await runner.migrate(boundary)).applied).toEqual([1, 2]);
				expect((await runner.migrate(boundary)).applied).toEqual([]);
				expect(await boundary.query<{ foreign_keys: number }>("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
				expect(await boundary.query<{ journal_mode: string }>("PRAGMA journal_mode")).toEqual([{ journal_mode: "wal" }]);
				expect(await boundary.query<{ timeout: number }>("PRAGMA busy_timeout")).toEqual([{ timeout: 5000 }]);
				expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM __app_migrations")).toEqual([{ count: 2 }]);
				await expect(
					boundary.withClient(async ({ client }) => client.loadExtension(join(directory, "missing.dylib"))),
				).rejects.toThrow();
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("upgrade fixture", () => {
	it("applies only the new migration after a previous-version fixture", async () => {
		await withFreshDatabase(async ({ databasePath, migrationsPath }) => {
			await writeMigration(migrationsPath, "0001_base.sql", "CREATE TABLE records (id INTEGER PRIMARY KEY);");
			const firstSource = await MigrationSource.fromDirectory(migrationsPath);
			const boundary = new DatabaseBoundary(databasePath);
			try {
				const runner = new MigrationRunner(firstSource);
				expect((await runner.migrate(boundary)).applied).toEqual([1]);
				await writeMigration(migrationsPath, "0002_extra.sql", "ALTER TABLE records ADD COLUMN label TEXT;");
				const upgradeRunner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath));
				expect((await upgradeRunner.migrate(boundary)).applied).toEqual([2]);
				expect((await boundary.query<{ name: string }>("PRAGMA table_info(records)")).some((column) => column.name === "label")).toBe(true);
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("migration validation", () => {
	it("rejects gaps, malformed ordering, removed files, and checksum drift", async () => {
		await withFreshDatabase(async ({ databasePath, migrationsPath }) => {
			await writeMigration(migrationsPath, "0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
			await writeMigration(migrationsPath, "0003_gap.sql", "CREATE TABLE gap (id INTEGER PRIMARY KEY);");
			await expect(MigrationSource.fromDirectory(migrationsPath)).rejects.toThrow();
			await rm(join(migrationsPath, "0003_gap.sql"));
			await writeMigration(migrationsPath, "bad-name.sql", "SELECT 1;");
			await expect(MigrationSource.fromDirectory(migrationsPath)).rejects.toThrow();
			await rm(join(migrationsPath, "bad-name.sql"));

			const source = await MigrationSource.fromDirectory(migrationsPath);
			const boundary = new DatabaseBoundary(databasePath);
			try {
				await new MigrationRunner(source).migrate(boundary);
				await writeMigration(migrationsPath, "0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY, drift TEXT);");
				const changedSource = await MigrationSource.fromDirectory(migrationsPath);
				await expect(new MigrationRunner(changedSource).verify(boundary)).rejects.toThrow(/checksum/i);
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("migration rollback", () => {
	it("rolls back a failed migration and does not apply later migrations", async () => {
		await withFreshDatabase(async ({ databasePath, migrationsPath }) => {
			await writeMigration(migrationsPath, "0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
			await writeMigration(
				migrationsPath,
				"0002_failing.sql",
				"CREATE TABLE second (id INTEGER PRIMARY KEY); INSERT INTO missing_table VALUES (1);",
			);
			await writeMigration(migrationsPath, "0003_later.sql", "CREATE TABLE later (id INTEGER PRIMARY KEY);");
			const boundary = new DatabaseBoundary(databasePath);
			try {
				const runner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath));
				await expect(runner.migrate(boundary)).rejects.toThrow();
				expect(await boundary.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('second', 'later')")).toEqual([]);
				expect(await boundary.query<{ id: number }>("SELECT id FROM __app_migrations")).toEqual([{ id: 1 }]);
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("transaction rollback", () => {
	it("enforces foreign keys and rolls back BEGIN IMMEDIATE work", async () => {
		await withFreshDatabase(async ({ databasePath }) => {
			const boundary = new DatabaseBoundary(databasePath);
			try {
				await boundary.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
				await boundary.execute("CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))");
				await expect(boundary.withTransaction(async () => {
					await boundary.execute("INSERT INTO child(id, parent_id) VALUES (1, 999)");
				})).rejects.toThrow();
				expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM child")).toEqual([{ count: 0 }]);

				await expect(boundary.withTransaction(async () => {
					await boundary.execute("INSERT INTO parent(id) VALUES (1)");
					throw new Error("rollback");
				})).rejects.toThrow("rollback");
				expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM parent")).toEqual([{ count: 0 }]);
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("nested transaction context", () => {
	it("reuses the exact client and rolls back when nested failure is caught", async () => {
		await withFreshDatabase(async ({ databasePath }) => {
			const boundary = new DatabaseBoundary(databasePath);
			try {
				await boundary.execute("CREATE TABLE entries (id INTEGER PRIMARY KEY)");
				const clients: object[] = [];
				await expect(boundary.withTransaction(async (outer) => {
					clients.push(outer.client);
					try {
						await boundary.withTransaction(async (inner) => {
							clients.push(inner.client);
							await boundary.execute("INSERT INTO entries(id) VALUES (1)");
							throw new Error("nested failure");
						});
					} catch {
						// The outer transaction must remain rollback-only after a caught nested error.
					}
					await boundary.execute("INSERT INTO entries(id) VALUES (2)");
				})).rejects.toBeInstanceOf(TransactionRollbackOnlyError);
				expect(clients[0]).toBe(clients[1]);
				expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM entries")).toEqual([{ count: 0 }]);
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("FIFO boundary", () => {
	it("serializes concurrent operations and rejects work after deterministic close", async () => {
		await withFreshDatabase(async ({ databasePath }) => {
			const boundary = new DatabaseBoundary(databasePath);
			try {
				const order: number[] = [];
				await Promise.all([
					boundary.withClient(async () => {
						order.push(1);
						await new Promise((resolve) => setTimeout(resolve, 5));
						order.push(2);
					}),
					boundary.withClient(async () => {
						order.push(3);
						order.push(4);
					}),
				]);
				expect(order).toEqual([1, 2, 3, 4]);
				await boundary.close();
				expect(await boundary.close()).toBeUndefined();
				expect(() => boundary.execute("SELECT 1")).toThrow(/closed/i);
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("integrity verification", () => {
	it("runs foreign_key_check, integrity_check, and migration verification", async () => {
		await withFreshDatabase(async ({ databasePath, migrationsPath }) => {
			await writeMigration(migrationsPath, "0001_schema.sql", "CREATE TABLE sample (id INTEGER PRIMARY KEY);");
			const boundary = new DatabaseBoundary(databasePath);
			try {
				const runner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath));
				await runner.migrate(boundary);
				await expect(runner.verify(boundary)).resolves.toBeUndefined();
			} finally {
				await boundary.close();
			}
		});
	});
});

describe("migration fixture hygiene", () => {
	it("keeps SQL source immutable as a content snapshot", async () => {
		await withFreshDatabase(async ({ migrationsPath }) => {
			await writeMigration(migrationsPath, "0001_snapshot.sql", "CREATE TABLE snapshot (id INTEGER PRIMARY KEY);");
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await writeFile(join(migrationsPath, "0001_snapshot.sql"), "SELECT leaked_content;\n", "utf8");
			expect(source.all()[0]?.sql).toContain("CREATE TABLE snapshot");
			expect(await readFile(join(migrationsPath, "0001_snapshot.sql"), "utf8")).toContain("leaked_content");
		});
	});
});
