import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Clock } from "../../application/ports/clock.js";
import { SystemClock } from "../time/system-clock.js";
import { DatabaseBoundary, type DatabaseContext } from "./database-boundary.js";

const MIGRATION_FILENAME = /^(\d{4})_([a-z][a-z0-9_-]*)\.sql$/;
const HISTORY_TABLE = "__app_migrations";

export interface Migration {
	readonly id: number;
	readonly filename: string;
	readonly sql: string;
	readonly checksum: string;
}

export interface MigrationResult {
	readonly applied: readonly number[];
	readonly noOp: boolean;
}

export class MigrationSource {
	private constructor(private readonly migrations: readonly Migration[]) {}

	static async fromDirectory(directory: string): Promise<MigrationSource> {
		const entries = await readdir(directory, { withFileTypes: true });
		if (entries.some((entry) => !entry.isFile())) {
			throw new Error("migration directory contains a non-file entry");
		}
		const files = entries
			.map((entry) => entry.name)
			.sort();
		if (files.some((filename) => !MIGRATION_FILENAME.test(filename))) {
			throw new Error("migration directory contains a malformed filename");
		}

		const migrations = await Promise.all(
			files.map(async (filename): Promise<Migration> => {
				const match = MIGRATION_FILENAME.exec(filename);
				if (match === null) {
					throw new Error("migration filename is invalid");
				}
				const sql = await readFile(join(directory, filename), "utf8");
				return Object.freeze({
					id: Number(match[1]),
					filename,
					sql,
					checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
				});
			}),
		);
		migrations.sort((left, right) => left.id - right.id);
		for (const [index, migration] of migrations.entries()) {
			if (migration.id !== index + 1) {
				throw new Error("migration IDs must form an ordered prefix without gaps");
			}
		}
		return new MigrationSource(Object.freeze(migrations));
	}

	all(): readonly Migration[] {
		return this.migrations;
	}
}

export class MigrationRunner {
	constructor(
		private readonly source: MigrationSource,
		private readonly clock: Clock = new SystemClock(),
	) {}

	async migrate(boundary: DatabaseBoundary): Promise<MigrationResult> {
		return boundary.withClient(async (context) => {
			await ensureHistoryTable(context);
			const applied = await readApplied(context);
			validateAppliedPrefix(applied, this.source.all());

			const pending = this.source.all().slice(applied.length);
			for (const migration of pending) {
				const appliedAt = this.clock.now().getTime();
				if (!Number.isFinite(appliedAt)) {
					throw new Error("migration clock returned an invalid date");
				}
				await boundary.withTransaction(async ({ client }) => {
					client.exec(migration.sql);
					client
						.prepare(
							`INSERT INTO ${HISTORY_TABLE} (id, filename, checksum, applied_at) VALUES (?, ?, ?, ?)`,
						)
						.run(migration.id, migration.filename, migration.checksum, appliedAt);
				});
			}
			return { applied: pending.map((migration) => migration.id), noOp: pending.length === 0 };
		});
	}

	async verify(boundary: DatabaseBoundary): Promise<void> {
		await boundary.withClient(async (context) => {
			await ensureHistoryTable(context);
			const applied = await readApplied(context);
			validateAppliedPrefix(applied, this.source.all());
			if (applied.length !== this.source.all().length) {
				throw new Error("database has unapplied migrations");
			}

			const foreignKeyProblems = await boundary.query("PRAGMA foreign_key_check");
			if (foreignKeyProblems.length > 0) {
				throw new Error("foreign_key_check failed");
			}
			const integrityRows = await boundary.query<{ integrity_check: string }>("PRAGMA integrity_check");
			if (integrityRows[0]?.integrity_check !== "ok") {
				throw new Error("integrity_check failed");
			}
		});
	}
}

interface AppliedMigration {
	readonly id: number;
	readonly filename: string;
	readonly checksum: string;
}

async function ensureHistoryTable(context: DatabaseContext): Promise<void> {
	context.client.exec(`
		CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
			id INTEGER PRIMARY KEY,
			filename TEXT NOT NULL UNIQUE,
			checksum TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		)
	`);
}

async function readApplied(context: DatabaseContext): Promise<AppliedMigration[]> {
	return context.client
		.prepare(`SELECT id, filename, checksum FROM ${HISTORY_TABLE} ORDER BY id ASC`)
		.all() as unknown as AppliedMigration[];
}

function validateAppliedPrefix(applied: readonly AppliedMigration[], source: readonly Migration[]): void {
	if (applied.length > source.length) {
		throw new Error("database migration history contains unknown migrations");
	}
	for (const [index, row] of applied.entries()) {
		const expected = source[index];
		if (
			expected === undefined ||
			row.id !== expected.id ||
			row.filename !== expected.filename ||
			row.checksum !== expected.checksum
		) {
			throw new Error(`migration history checksum/order mismatch at ${row.id}`);
		}
	}
}
