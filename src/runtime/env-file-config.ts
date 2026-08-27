import { parseConfig, type AppConfig } from "../config/parse-config.js";
import { assertPrivateEnvFile } from "./private-runtime-paths.js";

export async function loadConfigFromEnvFile(envFilePath: string): Promise<AppConfig> {
	await assertPrivateEnvFile(envFilePath);
	if (typeof process.loadEnvFile !== "function") throw new Error("Node runtime lacks process.loadEnvFile");
	process.loadEnvFile(envFilePath);
	const values: Record<string, string | undefined> = {};
	for (const key of ["BOT_TOKEN", "EXPECTED_BOT_ID", "EXPECTED_BOT_USERNAME", "ADMIN_TELEGRAM_IDS", "SHOWCASE_CHANNEL_ID", "SHOWCASE_CHANNEL_USERNAME", "DATABASE_PATH", "LOG_LEVEL", "TIME_ZONE", "HELP_CONTACT"]) values[key] = process.env[key];
	return parseConfig(values).config;
}
