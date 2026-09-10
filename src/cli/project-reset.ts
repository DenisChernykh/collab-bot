import { readFile, realpath } from "node:fs/promises";
import { DatabaseBoundary } from "../platform/database/database-boundary.js";
import { inspectProjectReset, resetProjectDatabase, type ResetRequest } from "../platform/database/project-reset.js";

async function main(): Promise<void> {
	const [action, path, requestPath, ...extra] = process.argv.slice(2);
	if (!path || extra.length || !["inspect", "apply"].includes(action ?? "") || (action === "apply") !== (requestPath !== undefined)) throw new Error("reset_invalid_arguments");
	const actualPath = await realpath(path); // Never create a missing database.
	const target = `local:${actualPath}`;
	const database = new DatabaseBoundary(actualPath);
	try {
		const integrity = await database.query<{ integrity_check: string }>("PRAGMA integrity_check");
		if (integrity[0]?.integrity_check !== "ok") throw new Error("reset_integrity_failed");
		const result = action === "inspect" ? await inspectProjectReset(database, target)
			: await resetProjectDatabase(database, target, JSON.parse(await readFile(requestPath!, "utf8")) as ResetRequest);
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} finally { await database.close(); }
}
main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error && /^reset_[a-z_]+$/u.test(error.message) ? error.message : "reset_failed"}\n`);
	process.exitCode = 1;
});
