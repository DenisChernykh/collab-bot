import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseBoundary } from "../platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../platform/database/migrations.js";

async function main(): Promise<void> {
	if (process.argv.length !== 2) {
		throw new Error("db:verify does not accept database or environment paths");
	}
	const directory = await mkdtemp(join(tmpdir(), "collaboration-db-verify-"));
	const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
	const databasePath = join(directory, "verify.sqlite");
	const boundary = new DatabaseBoundary(databasePath);
	try {
		const runner = new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath));
		await runner.migrate(boundary);
		await runner.verify(boundary);
		process.stdout.write("db:verify PASS\n");
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

main().catch(() => {
	process.stderr.write("db:verify failed\n");
	process.exitCode = 1;
});
