import { Bot } from "grammy";

import type { Clock } from "../../shared/application/ports/clock.js";
import type { AppConfig } from "../../config/parse-config.js";
import { DatabaseBoundary } from "../../platform/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../platform/database/migrations.js";
import { SystemClock } from "../../platform/time/system-clock.js";
import { composeBotApplication } from "../composition/bot-application.js";
import { createBotRuntimeLifecycle, type BotRuntimeLifecycle } from "../lifecycle/bot-lifecycle.js";
import { loadConfigFromEnvFile } from "./env-file-config.js";
import { ensurePrivateDatabasePath } from "./private-runtime-paths.js";

export interface BotRuntime {
	readonly bot: Bot;
	readonly boundary: DatabaseBoundary;
	readonly start: () => Promise<void>;
	readonly stop: () => Promise<void>;
	readonly shutdown: () => Promise<void>;
}

export interface BotRuntimeOptions {
	readonly config: AppConfig;
	readonly migrationsDirectory: string;
	readonly clock?: Clock;
	readonly bot?: Bot;
	readonly botFactory?: (token: string) => Bot;
	readonly databaseFactory?: (databasePath: string) => DatabaseBoundary;
	readonly logSink?: (line: string) => void;
}

export interface BotRuntimeArgumentsOptions extends Omit<BotRuntimeOptions, "config"> {
	readonly args: readonly string[];
}

export interface BotRuntimeBootstrapDependencies {
	readonly loadConfig: (envFilePath: string) => Promise<AppConfig>;
	readonly createRuntime: (options: BotRuntimeOptions) => Promise<BotRuntime>;
}

export async function createBotRuntime(options: BotRuntimeOptions): Promise<BotRuntime> {
	await ensurePrivateDatabasePath(options.config.databasePath);
	const clock = options.clock ?? new SystemClock();
	const boundary = (options.databaseFactory ?? ((path) => new DatabaseBoundary(path)))(options.config.databasePath);
	let lifecycle: BotRuntimeLifecycle | undefined;
	try {
		const source = await MigrationSource.fromDirectory(options.migrationsDirectory);
		const bot = options.bot ?? (options.botFactory ?? ((token) => new Bot(token)))(options.config.botToken);
		const application = composeBotApplication({
			bot,
			boundary,
			config: options.config,
			clock,
			migrate: () => new MigrationRunner(source, clock).migrate(boundary),
			...(options.logSink === undefined ? {} : { logSink: options.logSink }),
		});
		lifecycle = createBotRuntimeLifecycle(application.lifecycle);
		await lifecycle.configure();
		return {
			bot: application.bot,
			boundary: application.boundary,
			start: lifecycle.start,
			stop: lifecycle.stop,
			shutdown: lifecycle.shutdown,
		};
	} catch (error) {
		if (lifecycle === undefined) await boundary.close();
		else await lifecycle.stop();
		throw error;
	}
}

export function parseBotEnvFileArguments(args: readonly string[]): string {
	if (args.length === 1 && args[0]?.startsWith("--env-file=")) {
		const value = args[0].slice("--env-file=".length);
		if (value !== "") return value;
	}
	if (args.length === 2 && args[0] === "--env-file" && args[1] !== undefined && args[1] !== "") return args[1];
	throw new Error("usage: bot --env-file <absolute-private-file>");
}

export async function createBotRuntimeFromArguments(
	options: BotRuntimeArgumentsOptions,
	dependencies: BotRuntimeBootstrapDependencies = {
		loadConfig: loadConfigFromEnvFile,
		createRuntime: createBotRuntime,
	},
): Promise<BotRuntime> {
	const { args, ...runtimeOptions } = options;
	const config = await dependencies.loadConfig(parseBotEnvFileArguments(args));
	return dependencies.createRuntime({ config, ...runtimeOptions });
}
