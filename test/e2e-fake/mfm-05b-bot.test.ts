import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackForUser, privateMessageForUser } from "../support/fake-telegram.js";
import { decodeMfmCallback } from "../../src/modules/profiles/presentation/telegram/mfm-callback-codec.js";
import type { OnboardingAction } from "../../src/modules/profiles/application/onboarding-service.js";
import { FakeClock } from "../support/fake-clock.js";

it.each(["ru", "en"] as const)("runs the real MFM router in %s and blocks every classic entry", async (language) => {
	const directory = await mkdtemp(join(tmpdir(), "mfm-bot-"));
	const { runtime, fake } = await createFakeBotRuntime({ databasePath: join(directory, "app.sqlite"), mfmFeatureEnabled: true, clock: new FakeClock(1_700_000_000_000) });
	let update = 20000;
	let currentKeyboard: { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined;
	const refresh = () => {
		const call = [...fake.calls].reverse().find((x) => x.method === "sendMessage" || x.method === "editMessageText");
		currentKeyboard = call?.payload.reply_markup as typeof currentKeyboard;
	};
	const text = async (value: string) => { const event = { update_id: ++update, message: privateMessageForUser(update, 123, value, undefined, "Lucas") }; await runtime.bot.handleUpdate(event); refresh(); return event; };
	const callback = async (data: string) => { const event = { update_id: ++update, callback_query: callbackForUser(update, 123, data) }; await runtime.bot.handleUpdate(event); refresh(); return event; };
	const choose = async (action: OnboardingAction) => {
		const button = currentKeyboard?.inline_keyboard.flat().find((b) => b.callback_data !== undefined && JSON.stringify(decodeMfmCallback(b.callback_data)?.action) === JSON.stringify(action));
		if (button?.callback_data === undefined) throw new Error(`button missing: ${JSON.stringify(action)}`);
		return callback(button.callback_data);
	};
	try {
		await text("/start");
		expect(String(fake.lastMessage()?.text)).toContain("Choose your language");
		await choose({ kind: "language", value: language });
		await choose({ kind: "affiliation", value: "yes" });
		await choose({ kind: "choice", value: "participant" });
		await choose({ kind: "keep" });
		await choose({ kind: "choice", value: "specialist" });
		await choose({ kind: "city" });
		await choose({ kind: "choice", value: "digital_it" });
		expect(fake.calls.some((x) => x.method === "editMessageText")).toBe(true);
		await choose({ kind: "next" });
		await choose({ kind: "choice", value: "joint_projects" });
		await choose({ kind: "next" });
		await text(language === "ru" ? "Пропустить" : "Skip");
		await choose({ kind: "next" }); // photo
		const saved = await choose({ kind: "next" }); // about
		expect(String(fake.lastMessage()?.text)).toContain(language === "ru" ? "Профиль готов" : "Profile ready");
		await runtime.bot.handleUpdate(saved);
		for (const command of ["/create", "/browse", "/my", "/applications", "/start c_fake", "/start a_fake"]) await text(command);
		for (const data of ["collaboration:start", "browse:start", "application:own", "menu:home", "profile:create", "cb_old_token"]) await callback(data);
		expect(await runtime.boundary.query("SELECT * FROM collaborations")).toEqual([]);
		expect(await runtime.boundary.query("SELECT * FROM applications")).toEqual([]);
		expect(await runtime.boundary.query("SELECT * FROM profile_sessions")).toEqual([]);
		expect(await runtime.boundary.query("SELECT profile_id FROM mfm_profiles")).toHaveLength(1);
		const sent = fake.calls.filter((x) => x.method === "sendMessage" || x.method === "editMessageText").map((x) => JSON.stringify(x.payload)).join("\n");
		expect(sent).not.toContain("collaboration:start");
		expect(sent).not.toContain("browse:start");
	} finally { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }); }
});
