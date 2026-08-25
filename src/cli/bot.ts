import { fileURLToPath } from "node:url";

import { createBotRuntime, loadConfigFromEnvFile } from "../runtime/bot-runtime.js";

function parseEnvFile(args: readonly string[]): string {
	if (args.length === 1 && args[0]?.startsWith("--env-file=")) {
		const value = args[0].slice("--env-file=".length);
		if (value !== "") return value;
	}
	if (args.length === 2 && args[0] === "--env-file" && args[1] !== undefined && args[1] !== "") return args[1];
	throw new Error("usage: bot --env-file <absolute-private-file>");
}

async function main(): Promise<void> {
	const envFilePath = parseEnvFile(process.argv.slice(2));
	const config = await loadConfigFromEnvFile(envFilePath);
	const runtime = await createBotRuntime({
		config,
		migrationsDirectory: fileURLToPath(new URL("../../migrations/", import.meta.url)),
		logSink: (line) => process.stdout.write(`${line}\n`),
	});
	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		await runtime.shutdown();
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	try {
		await runtime.start();
	} finally {
		await shutdown();
	}
}

main().catch(() => {
	process.stderr.write("bot runtime failed\n");
	process.exitCode = 1;
});
