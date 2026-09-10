import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackForUser, privateMessageForUser } from "../support/fake-telegram.js";
import { connectionClock, connectionProfileId, seedConnectionPerson } from "../support/connections-fixture.js";
import { DeliveryRunner } from "../../src/shared/application/outbox/delivery-runner.js";
import { SqliteOutboxDeliveryRepository } from "../../src/platform/outbox/outbox-delivery-repository.js";
import { GrammyTelegramTransport } from "../../src/platform/telegram/grammy-telegram-transport.js";
import { SystemProviderDeadline } from "../../src/platform/time/provider-deadline.js";
import { RandomClaimTokenGenerator } from "../../src/platform/crypto/claim-token.js";

it.each(["ru", "en"] as const)("completes private introduction decisions and contacts in %s through the actual bot", async language => {
	const directory = await mkdtemp(join(tmpdir(), "mnet-full-"));
	const databasePath = join(directory, "app.sqlite");
	let fixture = await createFakeBotRuntime({ databasePath, mfmFeatureEnabled: true, clock: connectionClock });
	let sequence = 100000;
	const t = (ru: string, en: string) => language === "ru" ? ru : en;
	const message = async (id: number, text: string) => fixture.runtime.bot.handleUpdate({ update_id: ++sequence, message: privateMessageForUser(sequence, id, text) });
	const deliver = () => new DeliveryRunner(new SqliteOutboxDeliveryRepository(fixture.runtime.boundary), new GrammyTelegramTransport(fixture.runtime.bot), new SystemProviderDeadline(), new RandomClaimTokenGenerator(), connectionClock).runOnce();
	const last = () => [...fixture.fake.calls].reverse().find(x => x.method === "sendMessage" || x.method === "editMessageText")?.payload;
	const buttons = () => (last()?.reply_markup as { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] }).inline_keyboard.flat();
	const choose = async (id: number, ru: string, en: string) => {
		const data = buttons().find(x => x.text === t(ru, en))?.callback_data;
		if (!data) throw new Error(`missing ${t(ru, en)}`);
		expect(data.length).toBeLessThanOrEqual(64);
		const event = { update_id: ++sequence, callback_query: callbackForUser(sequence, id, data) };
		await fixture.runtime.bot.handleUpdate(event); return event;
	};
	try {
		for (const id of [1, 2, 3, 4]) await seedConnectionPerson(fixture.runtime.boundary, id, { language });
		await fixture.runtime.boundary.execute("INSERT INTO mfm_discovery_settings VALUES (?, 1, 1, 1)", [connectionProfileId(2)]);
		await message(1, "/start"); await choose(1, "🔎 Найти людей", "🔎 Find people");
		await choose(1, "🤝 Познакомиться", "🤝 Introduce yourself");
		await message(1, "short"); expect(String(last()?.text)).toContain("10–500");
		await message(1, "Synthetic invitation to discuss a project");
		expect(String(last()?.text)).toContain(t("после принятия", "after acceptance"));
		await fixture.runtime.shutdown(); fixture = await createFakeBotRuntime({ databasePath, clock: connectionClock, mfmFeatureEnabled: true, fake: fixture.fake });
		await message(1, "/start"); expect(String(last()?.text)).toContain("Synthetic invitation");
		const confirmed = await choose(1, "Отправить запрос", "Send introduction");
		await fixture.runtime.bot.handleUpdate(confirmed);
		const [request] = await fixture.runtime.boundary.query<{ public_token: string }>("SELECT public_token FROM introduction_requests");
		if (!request) throw new Error("missing request");
		const link = `/start n_${request.public_token}`;
		await deliver();
		const notification = [...fixture.fake.calls].reverse().find(x => x.method === "sendMessage" && String(x.payload.chat_id) === "2");
		expect(String(notification?.payload.text)).toContain(t("Новое знакомство", "New introduction"));
		expect(JSON.stringify(notification?.payload)).not.toMatch(/private_person|tg:\/\/user/);
		await message(3, link); expect(String(last()?.text)).not.toContain("Synthetic invitation");
		await message(2, link); expect(String(last()?.text)).toContain("Synthetic invitation");
		expect(buttons().some(x => x.url?.startsWith("tg://"))).toBe(false);
		const accepted = await choose(2, "✅ Принять", "✅ Accept");
		expect(buttons().some(x => x.url === "tg://user?id=1")).toBe(true);
		await fixture.runtime.bot.handleUpdate(accepted);
		expect(buttons().some(x => x.url === "tg://user?id=1")).toBe(true);
		await message(1, link); expect(buttons().some(x => x.url === "tg://user?id=2")).toBe(true);
		await choose(1, "Мои знакомства", "My introductions");
		await choose(1, "Принятые", "Accepted"); expect(String(last()?.text)).toContain("Synthetic 2");
		expect(buttons().some(x => x.url?.startsWith("tg://"))).toBe(false);
		await choose(1, "Открыть запрос", "Open introduction"); expect(buttons().some(x => x.url === "tg://user?id=2")).toBe(true);
		for (const [sender, decision, ru, en] of [[3, "rejected", "Отклонить", "Decline"], [4, "withdrawn", "Отозвать запрос", "Withdraw introduction"]] as const) {
			await message(sender, "/start"); await choose(sender, "🔎 Найти людей", "🔎 Find people");
			await choose(sender, "🤝 Познакомиться", "🤝 Introduce yourself"); await message(sender, "Another synthetic introduction message"); await choose(sender, "Отправить запрос", "Send introduction");
			const [row] = await fixture.runtime.boundary.query<{ public_token: string }>("SELECT public_token FROM introduction_requests WHERE sender_profile_id = ?", [connectionProfileId(sender)]);
			if (!row) throw new Error("missing decision request");
			const actor = decision === "withdrawn" ? sender : 2;
			await message(actor, `/start n_${row.public_token}`); await choose(actor, ru, en);
			expect(buttons().some(x => x.url?.startsWith("tg://"))).toBe(false);
			expect(await fixture.runtime.boundary.query("SELECT status FROM introduction_requests WHERE public_token = ?", [row.public_token])).toEqual([{ status: decision }]);
		}
		for (let i = 0; i < 8; i++) await deliver();
		expect(await fixture.runtime.boundary.query("SELECT kind FROM outbox_deliveries WHERE kind <> 'dm_send'")).toEqual([]);
		expect(fixture.fake.calls.filter(x => x.method === "sendMessage" && String(x.payload.chat_id).startsWith("-"))).toEqual([]);
		expect(await fixture.runtime.boundary.query("SELECT * FROM applications")).toEqual([]);
		const receipts = JSON.stringify(await fixture.runtime.boundary.query("SELECT * FROM command_receipts"));
		expect(receipts).not.toContain("Synthetic invitation"); expect(receipts).not.toContain("tg://");
	} finally { await fixture.runtime.shutdown(); await rm(directory, { recursive: true, force: true }); }
});
