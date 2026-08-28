import { execFileSync } from "node:child_process";
import { chmod, open, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseBoundary } from "../platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../platform/database/migrations.js";
import { exportStateTransferManifest } from "../platform/database/state-transfer.js";

interface ExportArguments {
	databasePath: string;
	outputPath: string;
}

function parseArguments(args: readonly string[]): ExportArguments {
	if (args.length !== 5 || args[0] !== "--database" || args[2] !== "--output" || args[4] !== "--source-stopped") throw new Error("usage requires --database <absolute-file> --output <absolute-manifest> --source-stopped");
	const databasePath = safeAbsolutePath(args[1] ?? "", "database");
	const outputPath = safeAbsolutePath(args[3] ?? "", "output");
	if (outputPath === resolve(process.cwd()) || !relative(resolve(process.cwd()), outputPath).startsWith("..")) throw new Error("output must be outside the repository");
	return { databasePath, outputPath };
}

function safeAbsolutePath(value: string, kind: "database" | "output"): string {
	if (!isAbsolute(value)) throw new Error(`${kind} path must be absolute`);
	const resolved = resolve(value);
	if (resolved === "/") throw new Error(`${kind} path is too broad`);
	return resolved;
}

function assertSourceStopped(databasePath: string): void {
	try {
		const holders = execFileSync("lsof", ["-t", "--", databasePath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		if (holders !== "") throw new Error("source database is in use");
	} catch (error) {
		if (error instanceof Error && "status" in error && (error as Error & { status?: number }).status === 1) return;
		if (error instanceof Error && error.message === "source database is in use") throw error;
		throw new Error("could not verify source database is stopped");
	}
}

async function writeNewPrivateFile(path: string, content: string): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(content, "utf8");
	} finally {
		await handle.close();
	}
	await chmod(path, 0o600);
}

async function main(): Promise<void> {
	const { databasePath, outputPath } = parseArguments(process.argv.slice(2));
	const sourceStat = await stat(databasePath);
	if (!sourceStat.isFile()) throw new Error("database path must be a file");
	assertSourceStopped(databasePath);
	const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
	const boundary = new DatabaseBoundary(databasePath);
	try {
		const source = await MigrationSource.fromDirectory(migrationsPath);
		await new MigrationRunner(source).verify(boundary);
		const manifest = await exportStateTransferManifest(boundary);
		await writeNewPrivateFile(outputPath, `${JSON.stringify(manifest)}\n`);
		const rowCount = manifest.tables.reduce((total, table) => total + table.rowCount, 0);
		process.stdout.write(`state export PASS tables=${manifest.tables.length} rows=${rowCount} digest=${manifest.digest}\n`);
	} finally {
		await boundary.close();
	}
}

main().catch(() => {
	process.stderr.write("state export failed\n");
	process.exitCode = 1;
});
