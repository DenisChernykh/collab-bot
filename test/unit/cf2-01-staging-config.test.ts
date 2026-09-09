import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface WranglerEnvironment {
	readonly account_id?: string;
	readonly name?: string;
	readonly workers_dev?: boolean;
	readonly preview_urls?: boolean;
	readonly routes?: unknown;
	readonly exports?: unknown;
	readonly durable_objects?: unknown;
	readonly secrets?: {
		readonly required?: readonly string[];
	};
	readonly vars?: Readonly<Record<string, unknown>>;
}

interface WranglerConfig extends WranglerEnvironment {
	readonly env?: Readonly<Record<string, WranglerEnvironment>>;
}

async function readWranglerConfig(): Promise<WranglerConfig> {
	const contents = await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
	return JSON.parse(contents) as WranglerConfig;
}

describe("CF2-01 staging Wrangler configuration", () => {
	it("keeps the root Worker private and exposes only the isolated staging environment", async () => {
		const config = await readWranglerConfig();
		const staging = config.env?.staging;

		expect(config.account_id).toBeUndefined();
		expect(config.workers_dev).toBe(false);
		expect(staging).toBeDefined();
		expect(staging).toMatchObject({
			account_id: "643464cda99dd9fb036367674d42a62c",
			name: "collaboration-bot-staging",
			workers_dev: true,
			preview_urls: false,
		});
		expect(staging).not.toHaveProperty("routes");
	});

	it("declares a separate SQLite Durable Object and only non-secret staging vars", async () => {
		const config = await readWranglerConfig();
		const staging = config.env?.staging;

		expect(staging?.exports).toEqual(config.exports);
		expect(staging?.durable_objects).toEqual(config.durable_objects);
		expect(staging?.vars).toEqual({
			DEPLOYMENT_ENVIRONMENT: "staging",
			STATE_IMPORT_ENABLED: "false",
			MFM_FEATURE_ENABLED: "false",
			EXPECTED_BOT_ID: "8777929575",
			EXPECTED_BOT_USERNAME: "collaboration_development_bot",
			SHOWCASE_CHANNEL_ID: "-1004314534828",
			SHOWCASE_CHANNEL_USERNAME: "collaboration_showcase_dev",
			HELP_CONTACT: "@collaboration_bot_support",
		});
		expect(staging?.secrets?.required).toEqual([
			"BOT_TOKEN",
			"TELEGRAM_WEBHOOK_SECRET",
			"OPERATIONS_TOKEN",
			"ADMIN_TELEGRAM_IDS",
		]);
		for (const secretName of staging?.secrets?.required ?? []) {
			expect(staging?.vars).not.toHaveProperty(secretName);
		}
	});

	it("keeps every local dev-vars variant ignored except the tracked example", async () => {
		const [gitignore, example] = await Promise.all([
			readFile(new URL("../../.gitignore", import.meta.url), "utf8"),
			readFile(new URL("../../.dev.vars.example", import.meta.url), "utf8"),
		]);

		expect(gitignore).toContain(".dev.vars*");
		expect(gitignore).toContain("!.dev.vars.example");
		expect(example).toContain("EXPECTED_BOT_USERNAME=collaboration_development_bot");
		expect(example).toContain("SHOWCASE_CHANNEL_USERNAME=collaboration_showcase_dev");
	});
});
