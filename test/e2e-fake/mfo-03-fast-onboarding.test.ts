import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { Update } from "grammy/types";
import type { OnboardingAction } from "../../src/modules/profiles/application/onboarding-service.js";
import { decodeMfmCallback } from "../../src/modules/profiles/presentation/telegram/mfm-callback-codec.js";
import { SqliteOnboardingRepository } from "../../src/modules/profiles/infrastructure/sqlite-onboarding-repository.js";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackForUser, privateMessageForUser } from "../support/fake-telegram.js";
import { FakeClock } from "../support/fake-clock.js";

it("runs RU/EN fast onboarding through both native pickers, external link and skip without duplicate effects", async () => {
	const directory = await mkdtemp(join(tmpdir(), "mfo-telegram-"));
	const { runtime, fake } = await createFakeBotRuntime({ databasePath: join(directory, "app.sqlite"), mfmFeatureEnabled: true, clock: new FakeClock(1_700_000_000_000) });
	let sequence = 90_000;
	const latestCall = () => [...fake.calls].reverse().find((call) => call.method === "sendMessage" || call.method === "editMessageText");
	const actor = (userId: number, language: "ru" | "en", firstName: string, username?: string) => {
		const text = async (value: string) => runtime.bot.handleUpdate({ update_id: ++sequence, message: privateMessageForUser(sequence, userId, value, username, firstName) });
		const callback = async (data: string) => runtime.bot.handleUpdate({ update_id: ++sequence, callback_query: callbackForUser(sequence, userId, data, username, firstName) });
		const choose = async (action: OnboardingAction) => {
			const markup = latestCall()?.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined;
			const button = markup?.inline_keyboard?.flat().find((candidate) => candidate.callback_data !== undefined && JSON.stringify(decodeMfmCallback(candidate.callback_data)?.action) === JSON.stringify(action));
			if (button?.callback_data === undefined) throw new Error(`missing MFM button ${JSON.stringify(action)}`);
			await callback(button.callback_data);
		};
		const reachSpheres = async () => {
			await text("/start");
			await choose({ kind: "language", value: language });
			await choose({ kind: "affiliation", value: "yes" });
			await choose({ kind: "choice", value: "participant" });
			expect(String(latestCall()?.payload.text)).toContain(firstName);
			expect((latestCall()?.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat()).toContainEqual(expect.objectContaining({ text: language === "ru" ? "✓ Оставить как есть" : "✓ Keep as is" }));
			await choose({ kind: "keep" });
			await choose({ kind: "choice", value: "specialist" });
			await choose({ kind: "city" });
		};
		const reachContact = async (sphere = "digital_it") => {
			await reachSpheres();
			await choose({ kind: "choice", value: sphere });
			await choose({ kind: "next" });
		};
		const shared = (requestId: number, chatId: number, title?: string, sharedUsername?: string, privateChat = true): Update => {
			const message = privateMessageForUser(++sequence, userId, undefined, username, firstName);
			return { update_id: sequence, message: { ...message, ...(privateChat ? {} : { chat: { id: -100999, type: "supergroup" as const, title: "Synthetic group" } }), chat_shared: { request_id: requestId, chat_id: chatId, ...(title === undefined ? {} : { title }), ...(sharedUsername === undefined ? {} : { username: sharedUsername }) } } } as Update;
		};
		return { text, callback, choose, reachSpheres, reachContact, shared };
	};
	const picker = () => {
		const markup = latestCall()?.payload.reply_markup as { keyboard?: { text: string; request_chat?: { request_id: number; chat_is_channel: boolean } }[][] } | undefined;
		const buttons = markup?.keyboard?.flat() ?? [];
		const channel = buttons.find((button) => button.request_chat?.chat_is_channel === true)?.request_chat;
		const group = buttons.find((button) => button.request_chat?.chat_is_channel === false)?.request_chat;
		if (channel === undefined || group === undefined) throw new Error("both contact pickers must be rendered");
		return { channel, group, buttons };
	};
	try {
		const ru = actor(101, "ru", "Алиса", "alice_public");
		await ru.reachSpheres();
		for (const sphere of ["media", "digital_it", "creative_industries"]) await ru.choose({ kind: "choice", value: sphere });
		expect(String(latestCall()?.payload.text)).toContain("Выбрано: 3 из 3");
		expect((latestCall()?.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat()).toContainEqual(expect.objectContaining({ text: "Продолжить →" }));
		await ru.choose({ kind: "choice", value: "entrepreneurship" });
		expect(String(latestCall()?.payload.text)).toContain("максимум 3");
		await ru.choose({ kind: "choice", value: "creative_industries" });
		await ru.choose({ kind: "next" });
		const ruPicker = picker();
		expect(ruPicker.channel.request_id).not.toBe(ruPicker.group.request_id);
		const ruRepository = new SqliteOnboardingRepository(runtime.boundary);
		const beforeWrong = await ruRepository.getSession("101");
		await runtime.bot.handleUpdate(ru.shared(ruPicker.channel.request_id + 10, -100101, "Wrong", "wrong_public"));
		expect(await ruRepository.getSession("101")).toEqual(beforeWrong);
		const selected = ru.shared(ruPicker.channel.request_id, -100101, "Alice media", "alice_media");
		await runtime.bot.handleUpdate(selected);
		expect(fake.calls.slice(-2).map((call) => String(call.payload.text))).toEqual([expect.stringContaining("Alice media"), expect.stringContaining("Профиль готов 🎉")]);
		expect(fake.lastMessage()?.reply_markup?.inline_keyboard?.flat()).toContainEqual(expect.objectContaining({ text: "Найти людей →" }));
		const afterSelectionCalls = fake.calls.length;
		await runtime.bot.handleUpdate(selected);
		expect(fake.calls).toHaveLength(afterSelectionCalls);
		expect(await runtime.boundary.query("SELECT kind, username FROM mfm_profile_contacts WHERE profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '101')")).toEqual([{ kind: "telegram_channel", username: "alice_media" }]);
		const find = (fake.lastMessage()?.reply_markup?.inline_keyboard?.flat().find((button) => button.text === "Найти людей →") as { callback_data?: string } | undefined)?.callback_data;
		if (find === undefined) throw new Error("ready CTA missing");
		await ru.callback(find);
		expect(String(fake.lastMessage()?.text)).toContain("Найти людей");

		const en = actor(102, "en", "No Username");
		await en.reachContact("science_education");
		const enPicker = picker();
		const beforeGroup = await new SqliteOnboardingRepository(runtime.boundary).getSession("102");
		const unsafeDelivery = en.shared(enPicker.group.request_id, -100102, "Public group", "public_group");
		const unsafe = { ...unsafeDelivery, message: { ...unsafeDelivery.message!, chat: { id: -100999, type: "supergroup" as const, title: "Synthetic group" } } } as Update;
		const callsBeforeUnsafe = fake.calls.length;
		await runtime.bot.handleUpdate(unsafe);
		expect(fake.calls).toHaveLength(callsBeforeUnsafe);
		expect(await new SqliteOnboardingRepository(runtime.boundary).getSession("102")).toEqual(beforeGroup);
		const groupDelivery = en.shared(enPicker.group.request_id, -100102, "Public group", "public_group");
		await runtime.bot.handleUpdate(groupDelivery);
		expect(String(fake.lastMessage()?.text)).toContain("Profile ready 🎉");
		expect(await runtime.boundary.query("SELECT kind FROM mfm_profile_contacts WHERE profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '102')")).toEqual([{ kind: "telegram_group" }]);

		const external = actor(103, "en", "External");
		await external.reachContact("entrepreneurship");
		const externalPicker = picker();
		const callsBeforePrivate = fake.calls.length;
		await runtime.bot.handleUpdate(external.shared(externalPicker.channel.request_id, -100103, "Private channel"));
		expect(fake.calls).toHaveLength(callsBeforePrivate + 1);
		expect(String(fake.lastMessage()?.text)).toContain("public link");
		expect((fake.lastMessage()?.reply_markup as { remove_keyboard?: boolean } | undefined)?.remove_keyboard).toBe(true);
		await external.text("https://example.com/contact");
		expect(await runtime.boundary.query("SELECT kind, url FROM mfm_profile_contacts WHERE profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '103')")).toEqual([{ kind: "external", url: "https://example.com/contact" }]);

		const skip = actor(104, "ru", "Пропуск");
		await skip.reachContact("sports_health");
		await skip.text("Пропустить");
		expect(String(fake.lastMessage()?.text)).toContain("Профиль готов 🎉");
		expect(await runtime.boundary.query("SELECT * FROM mfm_profile_contacts WHERE profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '104')")).toEqual([]);

		const personal = actor(105, "en", "Personal Telegram");
		await personal.reachContact("civic_engagement");
		await personal.text("👤 My Telegram");
		expect(await runtime.boundary.query("SELECT kind FROM mfm_profile_contacts WHERE profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '105')")).toEqual([{ kind: "telegram_user" }]);
	} finally {
		await runtime.shutdown();
		await rm(directory, { recursive: true, force: true });
	}
});
