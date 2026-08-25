import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { DatabaseBoundary } from "../infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../infrastructure/database/migrations.js";

interface MigrateArguments {
	databasePath: string;
	migrationsPath: string;
}

function parseArguments(args: readonly string[]): MigrateArguments {
	if (args.length !== 4 || args[0] !== "--database" || args[2] !== "--migrations") {
		throw new Error("usage requires --database <absolute-file> --migrations <absolute-directory>");
	}
	const databasePath = safePath(args[1] ?? "", "database");
	const migrationsPath = safePath(args[3] ?? "", "migrations");
	if (databasePath === migrationsPath || databasePath === "/" || migrationsPath === "/") {
		throw new Error("database and migrations paths are too broad");
	}
	return { databasePath, migrationsPath };
}

function safePath(value: string, kind: "database" | "migrations"): string {
	if (!isAbsolute(value)) {
		throw new Error(`${kind} path must be absolute`);
	}
	const resolved = resolve(value);
	if (resolved === "/" || resolved === process.cwd()) {
		throw new Error(`${kind} path is too broad`);
	}
	return resolved;
}

async function main(): Promise<void> {
	const { databasePath, migrationsPath } = parseArguments(process.argv.slice(2));
	const migrationDirectory = await stat(migrationsPath);
	if (!migrationDirectory.isDirectory()) {
		throw new Error("migrations path must be a directory");
	}
	const source = await MigrationSource.fromDirectory(migrationsPath);
	const boundary = new DatabaseBoundary(databasePath);
	try {
		await new MigrationRunner(source).migrate(boundary);
		process.stdout.write("db:migrate PASS\n");
	} finally {
		await boundary.close();
	}
}

main().catch(() => {
	process.stderr.write("db:migrate failed\n");
	process.exitCode = 1;
});
