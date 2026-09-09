import { describe, expect, it } from "vitest";

import {
	ConfigValidationError,
	parseConfig,
	type ConfigInput,
} from "../../src/config/parse-config.js";

const validInput = (): ConfigInput => ({
	BOT_TOKEN: "synthetic-token",
	EXPECTED_BOT_ID: "900719925474099312345",
	EXPECTED_BOT_USERNAME: "@collaboration_bot",
	ADMIN_TELEGRAM_IDS: "100000000000000000001, 100000000000000000002",
	SHOWCASE_CHANNEL_ID: "-100900719925474099312345",
	SHOWCASE_CHANNEL_USERNAME: "@collaboration_showcase",
	DATABASE_PATH:
		"/Users/example/Library/Application Support/CollaborationBot/data/collaboration-bot.sqlite",
	LOG_LEVEL: "info",
	TIME_ZONE: "Asia/Yekaterinburg",
	HELP_CONTACT: "@collaboration_support",
});

describe("parseConfig", () => {
	it("parses the explicit input without coercing decimal IDs", () => {
		const result = parseConfig(validInput());

		expect(result.config.expectedBotId).toBe("900719925474099312345");
		expect(typeof result.config.expectedBotId).toBe("string");
		expect(result.config.showcaseChannelId).toBe(
			"-100900719925474099312345",
		);
		expect(result.config.expectedBotUsername).toBe("collaboration_bot");
		expect(result.config.showcaseChannelUsername).toBe(
			"collaboration_showcase",
		);
		expect(result.config.adminTelegramIds).toEqual([
			"100000000000000000001",
			"100000000000000000002",
		]);
	});

	it("returns deterministic warnings for unknown keys", () => {
		const result = parseConfig({ ...validInput(), Z_UNKNOWN: "synthetic" });

		expect(result.warnings).toEqual([
			{ code: "unknown_key", key: "Z_UNKNOWN" },
		]);
	});

	it("rejects missing and empty required values", () => {
		const input: ConfigInput = {
			...validInput(),
			BOT_TOKEN: "",
			HELP_CONTACT: undefined,
		};

		expect(() => parseConfig(input)).toThrow(ConfigValidationError);
		try {
			parseConfig(input);
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigValidationError);
			expect((error as ConfigValidationError).issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ key: "BOT_TOKEN" }),
					expect.objectContaining({ key: "HELP_CONTACT" }),
				]),
			);
		}
	});

	it("rejects duplicate admin IDs", () => {
		const input = { ...validInput(), ADMIN_TELEGRAM_IDS: "123, 123" };

		expect(() => parseConfig(input)).toThrowError(
			/ADMIN_TELEGRAM_IDS.*duplicate/i,
		);
	});

	it("rejects invalid fixed timezone, IDs, and database root", () => {
		const input = {
			...validInput(),
			EXPECTED_BOT_ID: "12.3",
			TIME_ZONE: "UTC",
			DATABASE_PATH: "/",
		};

		expect(() => parseConfig(input)).toThrow(ConfigValidationError);
	});

	it("uses explicit input even when process.env has conflicting values", () => {
		const envKeys = [
			"BOT_TOKEN",
			"EXPECTED_BOT_ID",
			"DATABASE_PATH",
			"TIME_ZONE",
		] as const;
		const previousValues = new Map<string, string | undefined>();
		const conflictingValues: Record<(typeof envKeys)[number], string> = {
			BOT_TOKEN: "environment-token-must-be-ignored",
			EXPECTED_BOT_ID: "7",
			DATABASE_PATH: "/environment/path.sqlite",
			TIME_ZONE: "UTC",
		};
		for (const key of envKeys) {
			previousValues.set(key, process.env[key]);
		}

		try {
			for (const key of envKeys) {
				process.env[key] = conflictingValues[key];
			}

			const result = parseConfig(validInput());

			expect(result.config.botToken).toBe("synthetic-token");
			expect(result.config.expectedBotId).toBe("900719925474099312345");
			expect(result.config.databasePath).toContain("/Users/example/");
			expect(result.config.timeZone).toBe("Asia/Yekaterinburg");
		} finally {
			for (const key of envKeys) {
				const previousValue = previousValues.get(key);
				if (previousValue === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = previousValue;
				}
			}
		}
	});
});


it("defaults MFM off and accepts only explicit booleans", () => {
	expect(parseConfig(validInput()).config.mfmFeatureEnabled).toBe(false);
	expect(parseConfig({ ...validInput(), MFM_FEATURE_ENABLED: "true" }).config.mfmFeatureEnabled).toBe(true);
	expect(parseConfig({ ...validInput(), MFM_FEATURE_ENABLED: "false" }).config.mfmFeatureEnabled).toBe(false);
	expect(parseConfig({ ...validInput(), MFM_FEATURE_ENABLED: "true" }).warnings).toEqual([]);
	for (const value of ["yes", "1", "", "TRUE"]) expect(() => parseConfig({ ...validInput(), MFM_FEATURE_ENABLED: value })).toThrow(ConfigValidationError);
});
