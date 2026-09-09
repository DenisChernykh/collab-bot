/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { Bot } from "grammy";
import { expect, it } from "vitest";

import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { composeBotApplication } from "../../src/runtime/composition/bot-application.js";
import { FakeClock } from "../support/fake-clock.js";
import { createFakeTelegramApi, FAKE_BOT_TOKEN, privateMessageForUser } from "../support/fake-telegram.js";

it("creates one profile and receipt atomically through the real router on Durable Object SQLite", async () => {
	const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("ap-03-profile-start"));
	expect((await stub.fetch("https://local/__cf1/schema")).status).toBe(200);
	await runInDurableObject(stub, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		const fake = createFakeTelegramApi();
		const app = composeBotApplication({
			database,
			clock: new FakeClock(1_700_000_000_000),
			bot: new Bot(FAKE_BOT_TOKEN, { client: { fetch: fake.fetch } }),
			config: {
				botToken: FAKE_BOT_TOKEN, expectedBotId: "777", expectedBotUsername: "collab_bot",
				adminTelegramIds: [], showcaseChannelId: "-1001", showcaseChannelUsername: "showcase",
				databasePath: "unused.sqlite", logLevel: "info", timeZone: "Asia/Yekaterinburg", helpContact: "@helpdesk",
			},
		});
		await app.lifecycle.initializeIdentity();
		const update = { update_id: 9001, message: privateMessageForUser(9001, 700, "/start", "private_name", "Telegram Name") };
		await app.bot.handleUpdate(update);
		await app.bot.handleUpdate(update);
		expect(await database.query("SELECT display_name, type FROM profiles WHERE telegram_user_id = '700'")).toEqual([{ display_name: "Telegram Name", type: null }]);
		expect(await database.query("SELECT * FROM profile_platforms")).toEqual([]);
		expect(await database.query("SELECT * FROM profile_sessions")).toEqual([]);
		expect(await database.query("SELECT update_id FROM processed_updates WHERE update_id = 9001")).toEqual([{ update_id: 9001 }]);
		await database.execute("CREATE TRIGGER ap_test_profile_failure BEFORE INSERT ON profiles WHEN NEW.telegram_user_id = '701' BEGIN SELECT RAISE(ABORT, 'test profile failure'); END;");
		await expect(app.bot.handleUpdate({ update_id: 9002, message: privateMessageForUser(9002, 701, "/start") })).rejects.toThrow("test profile failure");
		expect(await database.query("SELECT id FROM profiles WHERE telegram_user_id = '701'")).toEqual([]);
		expect(await database.query("SELECT update_id FROM processed_updates WHERE update_id = 9002")).toEqual([]);
		expect(await database.query("SELECT command_id FROM command_receipts WHERE telegram_update_id = 9002")).toEqual([]);
		await database.execute("DROP TRIGGER ap_test_profile_failure");
		await app.bot.handleUpdate({ update_id: 9002, message: privateMessageForUser(9002, 701, "/start") });
		expect(await database.query("SELECT display_name FROM profiles WHERE telegram_user_id = '701'")).toEqual([{ display_name: "User 701" }]);
	});
});
