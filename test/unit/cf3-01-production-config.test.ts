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

describe("CF3-01 production Wrangler configuration", () => {
	it("defines one isolated workers.dev production Worker and SQLite namespace", async () => {
		const config = await readWranglerConfig();
		const production = config.env?.production;

		expect(production).toMatchObject({
			account_id: "643464cda99dd9fb036367674d42a62c",
			name: "collaboration-bot-production",
			workers_dev: true,
			preview_urls: false,
		});
		expect(production).not.toHaveProperty("routes");
		expect(production?.exports).toEqual(config.exports);
		expect(production?.durable_objects).toEqual(config.durable_objects);
	});

	it("commits only production non-secret vars and keeps import disabled by default", async () => {
		const config = await readWranglerConfig();
		const production = config.env?.production;

		expect(production?.vars).toEqual({
			DEPLOYMENT_ENVIRONMENT: "production",
			STATE_IMPORT_ENABLED: "false",
			EXPECTED_BOT_ID: "8951630763",
			EXPECTED_BOT_USERNAME: "davay_vmeste_bot",
			SHOWCASE_CHANNEL_ID: "-1003941660389",
			SHOWCASE_CHANNEL_USERNAME: "davay_vmeste_collab",
			HELP_CONTACT: "@ChDenis",
		});
		expect(production?.secrets?.required).toEqual([
			"BOT_TOKEN",
			"TELEGRAM_WEBHOOK_SECRET",
			"OPERATIONS_TOKEN",
			"ADMIN_TELEGRAM_IDS",
		]);
		for (const secretName of production?.secrets?.required ?? []) {
			expect(production?.vars).not.toHaveProperty(secretName);
		}
	});
});
