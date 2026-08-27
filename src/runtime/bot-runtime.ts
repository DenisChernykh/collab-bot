import { access, chmod, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { Bot } from "grammy";

import type { AppConfig } from "../config/parse-config.js";
import type { Clock } from "../application/ports/clock.js";
import { parseConfig } from "../config/parse-config.js";
import { DatabaseBoundary } from "../infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../infrastructure/database/migrations.js";
import { SystemClock } from "../infrastructure/time/system-clock.js";
import { composeBotApplication } from "./bot-application.js";
import { createBotRuntimeLifecycle, type BotRuntimeLifecycle } from "./bot-lifecycle.js";

export { ALLOWED_UPDATES, assertBotIdentity } from "./bot-application.js";
export { GrammyTelegramAudienceReader } from "../infrastructure/telegram/grammy-telegram-audience-reader.js";

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

export async function loadConfigFromEnvFile(envFilePath: string): Promise<AppConfig> {
	await assertPrivateEnvFile(envFilePath);
	if (typeof process.loadEnvFile !== "function") throw new Error("Node runtime lacks process.loadEnvFile");
	process.loadEnvFile(envFilePath);
	const values: Record<string, string | undefined> = {};
	for (const key of ["BOT_TOKEN", "EXPECTED_BOT_ID", "EXPECTED_BOT_USERNAME", "ADMIN_TELEGRAM_IDS", "SHOWCASE_CHANNEL_ID", "SHOWCASE_CHANNEL_USERNAME", "DATABASE_PATH", "LOG_LEVEL", "TIME_ZONE", "HELP_CONTACT"]) values[key] = process.env[key];
	return parseConfig(values).config;
}

export async function assertPrivateEnvFile(envFilePath: string): Promise<void> {
	if (!isAbsolute(envFilePath)) throw new Error("env-file path must be absolute");
	const info = await lstat(envFilePath);
	if (!info.isFile()) throw new Error("env-file path must be a regular file");
	if (process.getuid !== undefined && info.uid !== process.getuid()) throw new Error("env-file must be owned by the current user");
	if ((info.mode & 0o777) !== 0o600) throw new Error("env-file mode must be 0600");
}

export async function ensurePrivateDatabasePath(databasePath: string): Promise<void> {
	if (!isAbsolute(databasePath) || resolve(databasePath) === "/") throw new Error("database path must be an absolute non-root path");
	const parent = resolve(dirname(databasePath));
	if (parent === resolve(process.cwd())) throw new Error("database parent must not be the repository root");
	const parentInfo = await lstat(parent);
	if (!parentInfo.isDirectory() || (parentInfo.mode & 0o777) !== 0o700) {
		throw new Error("database parent must be the current user's private 0700 directory");
	}
	if (process.getuid !== undefined && parentInfo.uid !== process.getuid()) {
		throw new Error("database parent must be owned by the current user");
	}
	await access(parent, constants.W_OK);
	try {
		await assertPrivateDatabaseFile(databasePath);
	} catch (error) {
		if (!isErrno(error, "ENOENT")) throw error;
		const handle = await open(databasePath, "wx", 0o600);
		await handle.close();
		await chmod(databasePath, 0o600);
		await assertPrivateDatabaseFile(databasePath);
	}
}

function isErrno(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function assertPrivateDatabaseFile(databasePath: string): Promise<void> {
	const info = await lstat(databasePath);
	if (!info.isFile()) throw new Error("database path must be a regular file");
	if (process.getuid !== undefined && info.uid !== process.getuid()) throw new Error("database must be owned by the current user");
	if ((info.mode & 0o777) !== 0o600) throw new Error("database mode must be 0600");
}
