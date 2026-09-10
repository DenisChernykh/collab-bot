/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { Bot } from "grammy";
import { expect, it } from "vitest";
import { CloudflareSqlDatabase } from "../../src/platform/database/cloudflare-sql-database.js";
import { exportStateTransferManifest, importStateTransferManifest } from "../../src/platform/database/state-transfer.js";
import { composeBotApplication } from "../../src/runtime/composition/bot-application.js";
import { createConnectionsFeature, type IntroductionAction } from "../../src/modules/connections/index.js";
import { encodeIntroductionCallback } from "../../src/modules/connections/presentation/telegram/introduction-callback-codec.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { SqliteOutboxDeliveryRepository } from "../../src/platform/outbox/outbox-delivery-repository.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";
import { connectionClock, connectionProfileId, seedConnectionPerson } from "../support/connections-fixture.js";
import { createFakeTelegramApi, FAKE_BOT_TOKEN, privateMessageForUser, callbackForUser } from "../support/fake-telegram.js";

function compose(database: CloudflareSqlDatabase, enabled: boolean) {
	const fake = createFakeTelegramApi();
	const bot = new Bot(FAKE_BOT_TOKEN, { client: { fetch: fake.fetch } });
	const feature = createConnectionsFeature({ database, transactions: new DatabaseBoundaryTransactionRunner(database), clock: connectionClock, crypto: webCryptoCapabilities, outboxStore: new SqliteOutboxDeliveryRepository(database), botUsername: "collab_bot", mfmFeatureEnabled: enabled });
	const app = composeBotApplication({ database, bot, clock: connectionClock, config: { mfmFeatureEnabled: enabled, botToken: FAKE_BOT_TOKEN, expectedBotId: "777", expectedBotUsername: "collab_bot", adminTelegramIds: [], showcaseChannelId: "-1001", showcaseChannelUsername: "showcase", databasePath: "unused", logLevel: "info", timeZone: "Asia/Yekaterinburg", helpContact: "@helpdesk" } });
	const event = async (sequence: number, id: number, action: IntroductionAction) => {
		const view = await feature.introductions!.view(String(id));
		if (view.kind === "unavailable") throw new Error("missing fixture session");
		return { update_id: sequence, callback_query: callbackForUser(sequence, id, encodeIntroductionCallback(action, view.session)) };
	};
	return { fake, bot, feature, app, event };
}

it("recovers a real-bot introduction after DO eviction, atomically delivers it, retains accepted contacts with the feature off and transfers history", async () => {
	const stub = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("mnet-06-recovery"));
	// Drain the response so it cannot keep the object alive during eviction.
	const schema = await stub.fetch("https://local/__cf1/schema");
	expect(schema.status).toBe(200);
	expect(await schema.json()).toMatchObject({ migrationCount: 16, integrity: "ok" });
	await runInDurableObject(stub, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		await seedConnectionPerson(database, 1); await seedConnectionPerson(database, 2, { language: "en" });
		await database.execute("INSERT INTO mfm_discovery_settings VALUES (?, 1, 1, 1)", [connectionProfileId(2)]);
		const j = compose(database, true); await j.app.lifecycle.initializeIdentity();
		await j.feature.api.open("1", "search");
		await j.bot.handleUpdate(await j.event(210000, 1, { kind: "begin" }));
		await j.bot.handleUpdate({ update_id: 210001, message: privateMessageForUser(210001, 1, "Привет!! 👋") });
		const before = await j.feature.introductions!.view("1");
		expect(before.kind).toBe("confirm");
		const request = await j.event(210002, 1, { kind: "confirm" });
		await database.execute("CREATE TRIGGER mnet_failure BEFORE INSERT ON outbox_deliveries BEGIN SELECT RAISE(ABORT, 'injected mnet failure'); END");
		const calls = j.fake.calls.length;
		await expect(j.bot.handleUpdate(request)).rejects.toThrow("injected mnet failure");
		expect(await j.feature.introductions!.view("1")).toEqual(before);
		expect(await database.query("SELECT * FROM introduction_requests")).toEqual([]);
		expect(await database.query("SELECT * FROM processed_updates WHERE update_id = 210002")).toEqual([]);
		expect(await database.query("SELECT * FROM command_receipts WHERE telegram_update_id = 210002")).toEqual([]);
		expect(j.fake.calls).toHaveLength(calls);
		await database.execute("DROP TRIGGER mnet_failure");
	});
	await evictDurableObject(stub);
	await runInDurableObject(stub, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		const j = compose(database, true); await j.app.lifecycle.initializeIdentity();
		expect(await j.feature.introductions!.view("1")).toMatchObject({ kind: "confirm", message: "Привет!! 👋" });
		const event = await j.event(210002, 1, { kind: "confirm" });
		await j.bot.handleUpdate(event); await j.bot.handleUpdate(event);
		expect(await database.query("SELECT * FROM introduction_requests")).toHaveLength(1);
		expect(await database.query("SELECT * FROM outbox_deliveries")).toHaveLength(1);
		await j.app.runDeliveryCycleOnce();
		expect(await database.query("SELECT status FROM outbox_deliveries")).toEqual([{ status: "sent" }]);
		expect(JSON.stringify(j.fake.calls)).not.toContain("private_person");
		const [request] = await database.query<{ public_token: string }>("SELECT public_token FROM introduction_requests");
		const off = compose(database, false); await off.app.lifecycle.initializeIdentity();
		await off.bot.handleUpdate({ update_id: 210003, message: privateMessageForUser(210003, 2, `/start n_${request!.public_token}`) });
		await off.bot.handleUpdate(await off.event(210004, 2, { kind: "decide", decision: "accepted", requestRevision: 1 }));
		expect(JSON.stringify(off.fake.lastMessage())).toContain("tg://user?id=1");
		expect(String(off.fake.lastMessage()?.text)).not.toMatch(/MFM|МФМ/);
		expect(await off.feature.api.open("1", "search")).toMatchObject({ kind: "home", notice: "disabled" });
		await off.app.runDeliveryCycleOnce(); await off.app.runDeliveryCycleOnce();
		expect(await database.query("SELECT status FROM outbox_deliveries")).toEqual([{ status: "sent" }, { status: "sent" }, { status: "sent" }]);
	});
	await evictDurableObject(stub);
	const manifest = await runInDurableObject(stub, (_instance, state) => exportStateTransferManifest(new CloudflareSqlDatabase(state.storage)));
	const target = env.COLLABORATION_STATE.get(env.COLLABORATION_STATE.idFromName("mnet-06-transfer"));
	expect(await (await target.fetch("https://local/__cf1/schema")).json()).toMatchObject({ migrationCount: 16, integrity: "ok" });
	await runInDurableObject(target, async (_instance, state) => {
		const database = new CloudflareSqlDatabase(state.storage);
		await importStateTransferManifest(database, manifest);
		expect(await database.query("SELECT status, revision FROM introduction_requests")).toEqual([{ status: "accepted", revision: 2 }]);
		expect(await database.query("SELECT visible FROM mfm_discovery_settings")).toEqual([{ visible: 1 }]);
		expect((await exportStateTransferManifest(database)).digest).toBe(manifest.digest);
		expect(await database.query("PRAGMA foreign_key_check")).toEqual([]);
	});
});
