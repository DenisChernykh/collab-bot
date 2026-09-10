import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackForUser, privateMessageForUser } from "../support/fake-telegram.js";
import { connectionClock, seedConnectionPerson } from "../support/connections-fixture.js";

it.each(["ru", "en"] as const)("offers consent and persistent discovery in the actual %s bot", async language => {
	const directory = await mkdtemp(join(tmpdir(), "mnet-bot-"));
	const databasePath = join(directory, "app.sqlite");
	let fixture = await createFakeBotRuntime({ databasePath, mfmFeatureEnabled: true, clock: connectionClock });
	let sequence = 90000;
	const message = async (id: number, text: string) => fixture.runtime.bot.handleUpdate({ update_id: ++sequence, message: privateMessageForUser(sequence, id, text) });
	const choose = async (id: number, label: string) => {
		const last = [...fixture.fake.calls].reverse().find(x => x.method === "sendMessage" || x.method === "editMessageText");
		const keyboard = last?.payload.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] };
		const data = keyboard?.inline_keyboard.flat().find(x => x.text === label)?.callback_data;
		if (!data) throw new Error(`missing button ${label}`);
		expect(data.length).toBeLessThanOrEqual(64);
		await fixture.runtime.bot.handleUpdate({ update_id: ++sequence, callback_query: callbackForUser(sequence, id, data) });
		return data;
	};
	const t = (ru: string, en: string) => language === "ru" ? ru : en;
	try {
		await seedConnectionPerson(fixture.runtime.boundary, 1, { language });
		await seedConnectionPerson(fixture.runtime.boundary, 2, { language, openTo: ["city_and_events"] });
		for (const id of [1, 2]) {
			await message(id, "/start"); await choose(id, t("👤 Мой профиль", "👤 My profile"));
			expect(String(fixture.fake.lastMessage()?.text)).toContain(t("скрыт", "hidden"));
			await choose(id, t("👁 Показывать в поиске", "👁 Show in search"));
		}
		await message(1, "/start"); await choose(1, t("🔎 Найти людей", "🔎 Find people"));
		expect(String(fixture.fake.lastMessage()?.text)).toContain(t("Для чего хотите познакомиться?", "Why would you like to connect?"));
		await choose(1, t("Любая цель", "Any purpose"));
		expect(String(fixture.fake.lastMessage()?.text)).toContain("Synthetic 2");
		expect(String(fixture.fake.lastMessage()?.text)).not.toContain("private_person");
		await choose(1, t("Сфера", "Field")); await choose(1, t("💻 Цифровизация и IT", "💻 Digitalization and IT"));
		await choose(1, t("Специализация", "Specialization")); await choose(1, t("AI / нейросети", "AI / neural networks"));
		await fixture.runtime.shutdown(); fixture = await createFakeBotRuntime({ databasePath, mfmFeatureEnabled: true, clock: connectionClock, fake: fixture.fake });
		await message(1, "/start");
		expect(String(fixture.fake.lastMessage()?.text)).toContain("Synthetic 2");
		await choose(1, t("К чему открыт", "Open to")); await choose(1, t("🤝 Для совместного проекта", "🤝 For a joint project"));
		expect(String(fixture.fake.lastMessage()?.text)).toContain(t("Пока никого", "No people"));
		await choose(1, t("Сбросить фильтры", "Reset filters"));
		expect(String(fixture.fake.lastMessage()?.text)).toContain("Synthetic 2");
		const data = await choose(1, t("← Назад", "← Back"));
		await seedConnectionPerson(fixture.runtime.boundary, 3, { experience: "classic" });
		await seedConnectionPerson(fixture.runtime.boundary, 4, { incomplete: true });
		for (const id of [3, 4]) {
			await message(id, "/start");
			await fixture.runtime.bot.handleUpdate({ update_id: ++sequence, callback_query: callbackForUser(sequence, id, data) });
		}
		expect(await fixture.runtime.boundary.query("SELECT telegram_user_id FROM connection_sessions ORDER BY telegram_user_id")).toEqual([{ telegram_user_id: "1" }, { telegram_user_id: "2" }]);
		const event = callbackForUser(++sequence, 1, data);
		if (!event.message) throw new Error("fixture message missing");
		const group = { update_id: sequence, callback_query: { ...event, message: { ...event.message, chat: { id: -100999, type: "supergroup" as const, title: "Synthetic group" } } } };
		const before = fixture.fake.calls.length;
		await fixture.runtime.bot.handleUpdate(group); await fixture.runtime.bot.handleUpdate(group);
		expect(fixture.fake.calls.slice(before).filter(x => x.method === "sendMessage" || x.method === "editMessageText")).toEqual([]);
		expect(await fixture.runtime.boundary.query("SELECT * FROM collaborations")).toEqual([]);
	} finally { await fixture.runtime.shutdown(); await rm(directory, { recursive: true, force: true }); }
});
