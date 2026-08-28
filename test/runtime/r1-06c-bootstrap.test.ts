import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../../src/config/parse-config.js";
import {
	createBotRuntimeFromArguments,
	parseBotEnvFileArguments,
	type BotRuntime,
} from "../../src/runtime/bootstrap/bot-bootstrap.js";

describe("R1-06C bot bootstrap", () => {
	it("accepts only the two existing env-file argument forms", () => {
		expect(parseBotEnvFileArguments(["--env-file=/private/bot.env"])).toBe("/private/bot.env");
		expect(parseBotEnvFileArguments(["--env-file", "/private/bot.env"])).toBe("/private/bot.env");
		for (const args of [[], ["--env-file="], ["--env-file", ""], ["--env-file", "/a", "extra"], ["--other", "/a"]]) {
			expect(() => parseBotEnvFileArguments(args)).toThrow("usage: bot --env-file <absolute-private-file>");
		}
	});

	it("loads configuration before constructing a prepared runtime", async () => {
		const runtime = runtimeStub();
		const loadConfig = vi.fn(async () => config);
		const createRuntime = vi.fn(async () => runtime);

		await expect(createBotRuntimeFromArguments({
			args: ["--env-file", "/private/bot.env"],
			migrationsDirectory: "/app/migrations",
			logSink: () => {},
		}, { loadConfig, createRuntime })).resolves.toBe(runtime);

		expect(loadConfig).toHaveBeenCalledWith("/private/bot.env");
		expect(createRuntime).toHaveBeenCalledWith({
			config,
			migrationsDirectory: "/app/migrations",
			logSink: expect.any(Function),
		});
	});

	it("does not construct runtime after config failure and preserves path/runtime failure", async () => {
		const configFailure = new Error("config failed");
		const createRuntime = vi.fn(async () => runtimeStub());
		await expect(createBotRuntimeFromArguments({
			args: ["--env-file=/private/bot.env"],
			migrationsDirectory: "/app/migrations",
		}, {
			loadConfig: async () => { throw configFailure; },
			createRuntime,
		})).rejects.toBe(configFailure);
		expect(createRuntime).not.toHaveBeenCalled();

		const pathFailure = new Error("database path failed");
		await expect(createBotRuntimeFromArguments({
			args: ["--env-file=/private/bot.env"],
			migrationsDirectory: "/app/migrations",
		}, {
			loadConfig: async () => config,
			createRuntime: async () => { throw pathFailure; },
		})).rejects.toBe(pathFailure);
	});
});

const config: AppConfig = {
	botToken: "synthetic-token",
	expectedBotId: "777",
	expectedBotUsername: "collab_bot",
	adminTelegramIds: ["900"],
	showcaseChannelId: "-1001",
	showcaseChannelUsername: "showcase",
	databasePath: "/private/app.sqlite",
	logLevel: "info",
	timeZone: "Asia/Yekaterinburg",
	helpContact: "@helpdesk",
};

function runtimeStub(): BotRuntime {
	return {
		bot: {} as never,
		boundary: {} as never,
		start: async () => {},
		stop: async () => {},
		shutdown: async () => {},
	};
}
