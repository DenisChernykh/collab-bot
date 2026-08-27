import { fileURLToPath } from "node:url";

import { Bot, type PollingOptions } from "grammy";

import type { Clock } from "../../src/application/ports/clock.js";
import type { AppConfig } from "../../src/config/parse-config.js";
import type { FakeTelegramApi } from "../../src/infrastructure/testing/fake-telegram-api.js";
import {
	createBotRuntime,
	type BotRuntime,
} from "../../src/runtime/bot-runtime.js";
import {
	createFakeTelegramApi,
	FAKE_BOT_TOKEN,
} from "./fake-telegram.js";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

export interface FakeBotRuntimeOptions {
	readonly databasePath: string;
	readonly clock?: Clock;
	readonly fake?: FakeTelegramApi;
	readonly bot?: Bot;
	readonly adminTelegramIds?: readonly string[];
	readonly logSink?: (line: string) => void;
}

export interface FakeBotRuntimeFixture {
	readonly runtime: BotRuntime;
	readonly fake: FakeTelegramApi;
}

export async function createFakeBotRuntime(options: FakeBotRuntimeOptions): Promise<FakeBotRuntimeFixture> {
	const fake = options.fake ?? createFakeTelegramApi();
	const bot = options.bot ?? new Bot(FAKE_BOT_TOKEN, { client: { fetch: fake.fetch } });
	if (options.bot === undefined) {
		bot.start = async (pollingOptions?: PollingOptions) => {
			(pollingOptions?.onStart as (() => void) | undefined)?.();
		};
		bot.stop = async () => {};
	}
	const config: AppConfig = {
		botToken: FAKE_BOT_TOKEN,
		expectedBotId: "777",
		expectedBotUsername: "collab_bot",
		adminTelegramIds: options.adminTelegramIds ?? [],
		showcaseChannelId: "-1001",
		showcaseChannelUsername: "showcase",
		databasePath: options.databasePath,
		logLevel: "info",
		timeZone: "Asia/Yekaterinburg",
		helpContact: "@helpdesk",
	};
	const runtime = await createBotRuntime({
		bot,
		config,
		migrationsDirectory,
		...(options.clock === undefined ? {} : { clock: options.clock }),
		...(options.logSink === undefined ? {} : { logSink: options.logSink }),
	});
	return { runtime, fake };
}
