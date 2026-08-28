import { webCryptoCapabilities } from "../crypto/capabilities.js";
import type { Clock } from "../../shared/application/ports/clock.js";
import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";
import { CLOUDFLARE_MIGRATION_MANIFEST, type CloudflareMigration } from "./cloudflare-migration-manifest.js";

const HISTORY_TABLE = "__app_migrations";

export interface CloudflareMigrationResult {
	readonly applied: readonly number[];
	readonly noOp: boolean;
}

export class CloudflareMigrationRunner {
	constructor(
		private readonly database: SqlDatabase,
		private readonly migrations: readonly CloudflareMigration[] = CLOUDFLARE_MIGRATION_MANIFEST,
		private readonly clock: Clock = { now: () => new Date() },
	) {}

	async migrate(): Promise<CloudflareMigrationResult> {
		verifyManifest(this.migrations);
		await this.ensureHistoryTable();
		const applied = await this.readApplied();
		validateAppliedPrefix(applied, this.migrations);
		const pending = this.migrations.slice(applied.length);

		for (const migration of pending) {
			const appliedAt = this.clock.now().getTime();
			if (!Number.isSafeInteger(appliedAt) || appliedAt < 0) {
				throw new Error("migration clock returned an invalid date");
			}
			await this.database.withTransaction(async () => {
				await this.database.execute(migration.sql);
				await this.database.execute(
					`INSERT INTO ${HISTORY_TABLE} (id, filename, checksum, applied_at) VALUES (?, ?, ?, ?)`,
					[migration.id, migration.filename, migration.checksum, appliedAt],
				);
			});
		}

		return { applied: pending.map(({ id }) => id), noOp: pending.length === 0 };
	}

	async verify(): Promise<void> {
		verifyManifest(this.migrations);
		await this.ensureHistoryTable();
		const applied = await this.readApplied();
		validateAppliedPrefix(applied, this.migrations);
		if (applied.length !== this.migrations.length) {
			throw new Error("database has unapplied migrations");
		}

		const foreignKeyProblems = await this.database.query("PRAGMA foreign_key_check");
		if (foreignKeyProblems.length > 0) {
			throw new Error("foreign_key_check failed");
		}
		const historyTable = await this.database.query<{ name?: unknown }>(
			"SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?",
			[HISTORY_TABLE],
		);
		if (historyTable.length !== 1) {
			throw new Error("migration history table is missing");
		}
	}

	private async ensureHistoryTable(): Promise<void> {
		await this.database.execute(`
			CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
				id INTEGER PRIMARY KEY,
				filename TEXT NOT NULL UNIQUE,
				checksum TEXT NOT NULL,
				applied_at INTEGER NOT NULL
			)
		`);
	}

	private readApplied(): Promise<readonly AppliedMigration[]> {
		return this.database.query<AppliedMigration>(
			`SELECT id, filename, checksum FROM ${HISTORY_TABLE} ORDER BY id ASC`,
		);
	}
}

interface AppliedMigration {
	readonly id: number;
	readonly filename: string;
	readonly checksum: string;
}

function verifyManifest(migrations: readonly CloudflareMigration[]): void {
	if (migrations.length === 0) throw new Error("cloudflare migration manifest is empty");
	for (const [index, migration] of migrations.entries()) {
		if (migration.id !== index + 1 || webCryptoCapabilities.hashUtf8(migration.sql) !== migration.checksum) {
			throw new Error(`cloudflare migration manifest checksum/order mismatch at ${migration.id}`);
		}
	}
}

function validateAppliedPrefix(
	applied: readonly AppliedMigration[],
	source: readonly CloudflareMigration[],
): void {
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
