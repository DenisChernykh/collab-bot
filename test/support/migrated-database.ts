import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Clock } from "../../src/shared/application/ports/clock.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

export interface FreshMigratedDatabaseFixture {
	readonly directory: string;
	readonly databasePath: string;
	readonly boundary: DatabaseBoundary;
	readonly appliedMigrations: readonly number[];
}

export interface FreshMigratedDatabaseOptions {
	readonly prefix: string;
	readonly clock: Clock;
}

export async function withFreshMigratedDatabase<T>(
	options: FreshMigratedDatabaseOptions,
	work: (fixture: FreshMigratedDatabaseFixture) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), options.prefix));
	const databasePath = join(directory, "app.sqlite");
	let boundary: DatabaseBoundary | undefined;
	try {
		boundary = new DatabaseBoundary(databasePath);
		const source = await MigrationSource.fromDirectory(migrationsDirectory);
		const migration = await new MigrationRunner(source, options.clock).migrate(boundary);
		return await work({
			directory,
			databasePath,
			boundary,
			appliedMigrations: migration.applied,
		});
	} finally {
		try {
			if (boundary !== undefined) await boundary.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}
