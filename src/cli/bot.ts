import { fileURLToPath } from "node:url";

import { createBotRuntimeFromArguments } from "../runtime/bootstrap/bot-bootstrap.js";
import { runBotProcess, type BotProcessSignalSource } from "../runtime/lifecycle/process-runner.js";

const processSignals: BotProcessSignalSource = {
	once: (signal, listener) => {
		process.once(signal, listener);
	},
	off: (signal, listener) => {
		process.off(signal, listener);
	},
};

async function main(): Promise<void> {
	const runtime = await createBotRuntimeFromArguments({
		args: process.argv.slice(2),
		migrationsDirectory: fileURLToPath(new URL("../../migrations/", import.meta.url)),
		logSink: (line) => process.stdout.write(`${line}\n`),
	});
	await runBotProcess(runtime, processSignals);
}

main().catch(() => {
	process.stderr.write("bot runtime failed\n");
	process.exitCode = 1;
});
