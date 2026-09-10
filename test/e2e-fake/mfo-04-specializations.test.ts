import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackForUser, privateMessageForUser } from "../support/fake-telegram.js";
import { connectionClock, seedConnectionPerson } from "../support/connections-fixture.js";

it.each(["ru", "en"] as const)("offers a small optional specialization editor in the actual %s bot", async (language) => {
	const directory = await mkdtemp(join(tmpdir(), "mfo-specializations-bot-"));
	const fixture = await createFakeBotRuntime({ databasePath: join(directory, "app.sqlite"), mfmFeatureEnabled: true, clock: connectionClock });
	let sequence = 95_000;
	const userId = language === "ru" ? 201 : 202;
	const message = async (text: string) => fixture.runtime.bot.handleUpdate({ update_id: ++sequence, message: privateMessageForUser(sequence, userId, text) });
	const choose = async (label: string) => {
		const last = [...fixture.fake.calls].reverse().find((call) => call.method === "sendMessage" || call.method === "editMessageText");
		const markup = last?.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined;
		const data = markup?.inline_keyboard?.flat().find((button) => button.text === label)?.callback_data;
		if (data === undefined) throw new Error(`missing button ${label}`);
		await fixture.runtime.bot.handleUpdate({ update_id: ++sequence, callback_query: callbackForUser(sequence, userId, data) });
	};
	const t = (ru: string, en: string) => language === "ru" ? ru : en;
	try {
		await seedConnectionPerson(fixture.runtime.boundary, userId, { language, spheres: ["media", "digital_it"], specializations: [], openTo: ["city_and_events"] });
		await message("/profile");
		await choose(t("✨ Дополнить профиль", "✨ Improve profile"));
		expect(String(fixture.fake.lastMessage()?.text)).toContain(t("Уточните специализацию", "Choose your specializations"));
		await choose(t("Блогер / контент-креатор", "Blogger / content creator"));
		await choose("▶");
		await choose(t("AI / нейросети", "AI / neural networks"));
		await choose(t("Сохранить", "Save"));
		expect(await fixture.runtime.boundary.query("SELECT specialization FROM mfm_profile_specializations WHERE profile_id = ? ORDER BY specialization", [await seedId(fixture.runtime.boundary, userId)])).toEqual([{ specialization: "ai" }, { specialization: "blogger" }]);
		expect(await fixture.runtime.boundary.query("SELECT intent FROM mfm_profile_open_to WHERE profile_id = ?", [await seedId(fixture.runtime.boundary, userId)])).toEqual([{ intent: "city_and_events" }]);
	} finally {
		await fixture.runtime.shutdown();
		await rm(directory, { recursive: true, force: true });
	}
});

async function seedId(database: { query<T>(sql: string, values?: readonly unknown[]): Promise<readonly T[]> }, userId: number): Promise<string> {
	const [row] = await database.query<{ id: string }>("SELECT id FROM profiles WHERE telegram_user_id = ?", [String(userId)]);
	if (row === undefined) throw new Error("profile missing");
	return row.id;
}
