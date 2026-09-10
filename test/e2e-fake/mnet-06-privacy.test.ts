import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackForUser, privateMessageForUser } from "../support/fake-telegram.js";
import { connectionClock, connectionProfileId, seedConnectionPerson } from "../support/connections-fixture.js";
import { createConnectionsFeature, type IntroductionAction } from "../../src/modules/connections/index.js";
import { encodeIntroductionCallback } from "../../src/modules/connections/presentation/telegram/introduction-callback-codec.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { SqliteOutboxDeliveryRepository } from "../../src/platform/outbox/outbox-delivery-repository.js";
import { webCryptoCapabilities } from "../../src/platform/crypto/capabilities.js";

it("rejects copied introduction decisions, classic/incomplete links, group replays and blocked accepted-contact replay", async () => {
	const directory = await mkdtemp(join(tmpdir(), "mnet-privacy-"));
	const { runtime, fake } = await createFakeBotRuntime({ databasePath: join(directory, "app.sqlite"), mfmFeatureEnabled: true, clock: connectionClock });
	const feature = createConnectionsFeature({ database: runtime.boundary, transactions: new DatabaseBoundaryTransactionRunner(runtime.boundary), clock: connectionClock, crypto: webCryptoCapabilities, outboxStore: new SqliteOutboxDeliveryRepository(runtime.boundary), botUsername: "collab_bot", mfmFeatureEnabled: true });
	const api = feature.introductions!;
	let sequence = 300000;
	const event = async (id: number, action: IntroductionAction) => {
		const view = await api.view(String(id));
		if (view.kind === "unavailable") throw new Error("missing fixture session");
		return { update_id: ++sequence, callback_query: callbackForUser(sequence, id, encodeIntroductionCallback(action, view.session)) };
	};
	const message = (id: number, text: string) => runtime.bot.handleUpdate({ update_id: ++sequence, message: privateMessageForUser(sequence, id, text) });
	try {
		for (const id of [1, 2, 3]) await seedConnectionPerson(runtime.boundary, id);
		await seedConnectionPerson(runtime.boundary, 4, { experience: "classic" }); await seedConnectionPerson(runtime.boundary, 5, { incomplete: true });
		await runtime.boundary.execute("INSERT INTO mfm_discovery_settings VALUES (?, 1, 1, 1)", [connectionProfileId(2)]);
		await feature.api.open("1", "search"); await runtime.bot.handleUpdate(await event(1, { kind: "begin" }));
		await message(1, "Private synthetic message for exactly one recipient"); await runtime.bot.handleUpdate(await event(1, { kind: "confirm" }));
		const [row] = await runtime.boundary.query<{ public_token: string }>("SELECT public_token FROM introduction_requests");
		const link = `/start n_${row!.public_token}`;
		await message(2, link); const accept = await event(2, { kind: "decide", decision: "accepted", requestRevision: 1 });
		for (const id of [3, 4, 5]) {
			const before = fake.calls.length;
			await message(id, link);
			await runtime.bot.handleUpdate({ update_id: ++sequence, callback_query: callbackForUser(sequence, id, accept.callback_query.data!) });
			expect(JSON.stringify(fake.calls.slice(before))).not.toContain("Private synthetic");
			expect(JSON.stringify(fake.calls.slice(before))).not.toContain("tg://");
		}
		const callback = accept.callback_query;
		if (!callback.message) throw new Error("fixture message missing");
		const group = { update_id: ++sequence, callback_query: { ...callback, message: { ...callback.message, chat: { id: -100999, type: "supergroup" as const, title: "Synthetic group" } } } };
		const before = fake.calls.length;
		await runtime.bot.handleUpdate(group); await runtime.bot.handleUpdate(group);
		expect(fake.calls.slice(before).filter(x => x.method === "sendMessage" || x.method === "editMessageText")).toEqual([]);
		expect(await runtime.boundary.query("SELECT status FROM introduction_requests")).toEqual([{ status: "pending" }]);
		await runtime.bot.handleUpdate(accept);
		expect(JSON.stringify(fake.lastMessage())).toContain("tg://user?id=1");
		await runtime.boundary.execute("UPDATE telegram_users SET status = 'blocked', blocked_at = 1 WHERE telegram_user_id = '1'");
		const blocked = fake.calls.length;
		await runtime.bot.handleUpdate(accept);
		expect(JSON.stringify(fake.calls.slice(blocked))).not.toContain("tg://");
		expect(await runtime.boundary.query("SELECT status FROM introduction_requests")).toEqual([{ status: "accepted" }]);
	} finally { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }); }
});
