import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DatabaseBoundary } from "../infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../infrastructure/database/migrations.js";

async function main(): Promise<void> {
	if (process.argv.length !== 2) {
		throw new Error("db:verify does not accept database or environment paths");
	}
	const directory = await mkdtemp(join(tmpdir(), "collaboration-db-verify-"));
	const migrationsPath = join(directory, "migrations");
	const databasePath = join(directory, "verify.sqlite");
	await mkdir(migrationsPath);
	await writeFile(
		join(migrationsPath, "0001_verify.sql"),
		"CREATE TABLE verify_parent (id INTEGER PRIMARY KEY);\n",
		"utf8",
	);
	await writeFile(
		join(migrationsPath, "0002_verify_child.sql"),
		"CREATE TABLE verify_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES verify_parent(id));\n",
		"utf8",
	);
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
