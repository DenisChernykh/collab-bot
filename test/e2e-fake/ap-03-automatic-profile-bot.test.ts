import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import { callbackData, callbackForUser, callbackValues, privateMessageForUser } from "../support/fake-telegram.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { FakeClock } from "../support/fake-clock.js";

it("creates a real profile from first and last name on start, preserves it across replay and restart, and completes it with the saved name", async () => {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-ap-03-"));
	const databasePath = join(directory, "app.sqlite");
	const clock = new FakeClock(1_700_000_000_000);
	let { runtime, fake } = await createFakeBotRuntime({ databasePath, clock });
	try {
		const firstMessage = privateMessageForUser(1, 100, "/start", "private_person", "First");
		const first = { update_id: 1, message: { ...firstMessage, from: { ...firstMessage.from!, last_name: "Last" } } };
		await runtime.bot.handleUpdate(first);
		const initial = await new SqliteProfileRepository(runtime.boundary).findActiveByTelegramUserId("100");
		expect(initial).toMatchObject({ type: null, displayName: "First Last", platforms: [] });
		expect(await runtime.boundary.query("SELECT * FROM profile_sessions")).toEqual([]);
		expect(callbackValues(fake)).toContain("browse:start");
		await runtime.bot.handleUpdate(first);
		await runtime.bot.handleUpdate({ update_id: 2, message: privateMessageForUser(2, 100, "/start", "new_private_person", "New name") });
		expect(await new SqliteProfileRepository(runtime.boundary).findActiveByTelegramUserId("100")).toEqual(initial);
		expect(await runtime.boundary.query("SELECT id FROM profiles")).toHaveLength(1);
		await runtime.bot.handleUpdate({ update_id: 3, message: privateMessageForUser(3, 100, "/profile") });
		expect(String(fake.lastMessage()?.text)).toContain("First Last");
		expect(String(fake.lastMessage()?.text)).toContain("Дополните");
		await runtime.bot.handleUpdate({ update_id: 4, callback_query: callbackForUser(4, 100, "profile:edit") });
		await runtime.bot.handleUpdate({ update_id: 5, callback_query: callbackForUser(5, 100, callbackData(fake, "profile:type:blogger")) });
		const keepName = callbackData(fake, "profile:keep_name");
		const savedSession = await runtime.boundary.query("SELECT * FROM profile_sessions");
		await runtime.shutdown();
		({ runtime, fake } = await createFakeBotRuntime({ databasePath, clock, fake }));
		await runtime.bot.handleUpdate({ update_id: 6, message: privateMessageForUser(6, 100, "/start", "new_private_person", "Another name") });
		expect(await runtime.boundary.query("SELECT * FROM profile_sessions")).toEqual(savedSession);
		expect(await new SqliteProfileRepository(runtime.boundary).findActiveByTelegramUserId("100")).toEqual(initial);
		await runtime.bot.handleUpdate({ update_id: 7, callback_query: callbackForUser(7, 100, keepName) });
		await runtime.bot.handleUpdate({ update_id: 8, message: privateMessageForUser(8, 100, "-") });
		await runtime.bot.handleUpdate({ update_id: 9, message: privateMessageForUser(9, 100, "-") });
		await runtime.bot.handleUpdate({ update_id: 10, callback_query: callbackForUser(10, 100, callbackData(fake, "profile:platform:other")) });
		await runtime.bot.handleUpdate({ update_id: 11, message: privateMessageForUser(11, 100, "https://example.com") });
		await runtime.bot.handleUpdate({ update_id: 12, message: privateMessageForUser(12, 100, "-") });
		await runtime.bot.handleUpdate({ update_id: 13, callback_query: callbackForUser(13, 100, callbackData(fake, "profile:apply")) });
		expect(await new SqliteProfileRepository(runtime.boundary).findActiveByTelegramUserId("100")).toMatchObject({ id: initial?.id, displayName: "First Last", type: "blogger" });
		expect(JSON.stringify(await new SqliteProfileRepository(runtime.boundary).findPublicById(initial!.id))).not.toContain("private_person");
		await runtime.boundary.execute("UPDATE profiles SET display_name = ? WHERE telegram_user_id = ?", ["Chosen Name", "100"]);
		await runtime.bot.handleUpdate({ update_id: 14, message: privateMessageForUser(14, 100, "/start", "private_person", "Telegram Again") });
		expect(await new SqliteProfileRepository(runtime.boundary).findActiveByTelegramUserId("100")).toMatchObject({ id: initial?.id, displayName: "Chosen Name" });
	} finally {
		await runtime.shutdown();
		await rm(directory, { recursive: true, force: true });
	}
});

it("creates a profile without a username and completes it before starting a collaboration", async () => {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-ap-03-no-username-"));
	const { runtime, fake } = await createFakeBotRuntime({ databasePath: join(directory, "app.sqlite"), clock: new FakeClock(1_700_000_000_000) });
	try {
		await runtime.bot.handleUpdate({ update_id: 1, message: privateMessageForUser(1, 200, "/start", undefined, "No Username") });
		const initial = await new SqliteProfileRepository(runtime.boundary).findActiveByTelegramUserId("200");
		expect(initial).toMatchObject({ type: null, displayName: "No Username", platforms: [] });
		await runtime.bot.handleUpdate({ update_id: 2, callback_query: callbackForUser(2, 200, "collaboration:start") });
		expect(await runtime.boundary.query("SELECT id FROM collaborations")).toEqual([]);
		await runtime.bot.handleUpdate({ update_id: 3, callback_query: callbackForUser(3, 200, callbackData(fake, "profile:type:blogger")) });
		await runtime.bot.handleUpdate({ update_id: 4, callback_query: callbackForUser(4, 200, callbackData(fake, "profile:keep_name")) });
		await runtime.bot.handleUpdate({ update_id: 5, message: privateMessageForUser(5, 200, "-") });
		await runtime.bot.handleUpdate({ update_id: 6, message: privateMessageForUser(6, 200, "-") });
		expect(callbackValues(fake).some((value) => value.startsWith("profile:platform:self"))).toBe(false);
		await runtime.bot.handleUpdate({ update_id: 7, callback_query: callbackForUser(7, 200, callbackData(fake, "profile:platform:other")) });
		await runtime.bot.handleUpdate({ update_id: 8, message: privateMessageForUser(8, 200, "https://example.com") });
		await runtime.bot.handleUpdate({ update_id: 9, message: privateMessageForUser(9, 200, "-") });
		await runtime.bot.handleUpdate({ update_id: 10, callback_query: callbackForUser(10, 200, callbackData(fake, "profile:apply")) });
		expect(await new SqliteProfileRepository(runtime.boundary).findActiveByTelegramUserId("200")).toMatchObject({ id: initial?.id, displayName: "No Username", type: "blogger" });
		expect(await runtime.boundary.query("SELECT author_profile_id FROM collaborations")).toEqual([{ author_profile_id: initial?.id }]);
		expect(String(fake.lastMessage()?.text)).toContain("формат");
	} finally {
		await runtime.shutdown();
		await rm(directory, { recursive: true, force: true });
	}
});
