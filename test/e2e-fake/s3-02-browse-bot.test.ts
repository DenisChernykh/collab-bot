import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";

import { createBotRuntime } from "../../src/runtime/bot-runtime.js";
import type { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { FakeTelegramApi } from "../../src/infrastructure/testing/fake-telegram-api.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));
const NOW = 1_700_000_000_000;
const FIRST_ID = "ffffffff-0000-4000-8000-000000000003";
const SECOND_ID = "eeeeeeee-0000-4000-8000-000000000003";
const FIRST_TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";
const SECOND_TOKEN = "BBBBBBBBBBBBBBBBBBBBBB";
const HIDDEN_TOKEN = "CCCCCCCCCCCCCCCCCCCCCC";

describe("S3-02 fake Telegram browse journey", () => {
	it("wires menu, revision-safe feed, filters, restart and strict deep links through the real runtime composition", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-02-browse-e2e-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(NOW);
		const fake = new FakeTelegramApi({
			token: "fake-token",
			botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
		});
		let runtime: Awaited<ReturnType<typeof createBotRuntime>> | undefined;
		try {
			runtime = await createRuntime(databasePath, fake, clock);
			await seedCards(runtime.boundary);

			await runtime.bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/start") });
			expect(callbackData(fake, "browse:start")).toBe("browse:start");
			await runtime.bot.handleUpdate({ update_id: 2, callback_query: callback(2, "browse:start") });
			expect(String(fake.lastMessage()?.text)).toContain("First browse card");
			expect(String(fake.lastMessage()?.text)).not.toContain(FIRST_ID);
			expect(String(fake.lastMessage()?.text)).not.toContain(FIRST_TOKEN);
			const firstButtons = callbackValues(fake);
			expect(firstButtons.some((value) => value.startsWith(`application:start:${FIRST_TOKEN}`))).toBe(true);
			expect(firstButtons.every((value) => Buffer.byteLength(value, "utf8") <= 64)).toBe(true);
			const oldNext = callbackData(fake, "b:n:");

			await runtime.bot.handleUpdate({ update_id: 3, callback_query: callback(3, oldNext) });
			expect(String(fake.lastMessage()?.text)).toContain("Second browse card");
			const currentFilters = callbackData(fake, "b:fs:");
			const cursorAfterNext = await runtime.boundary.query("SELECT cursor_collaboration_id, revision FROM browse_sessions WHERE telegram_user_id = '200'");
			expect(cursorAfterNext).toEqual([{ cursor_collaboration_id: SECOND_ID, revision: expect.any(Number) }]);

			await runtime.bot.handleUpdate({ update_id: 3, callback_query: callback(3, oldNext) });
			expect(await runtime.boundary.query("SELECT cursor_collaboration_id, revision FROM browse_sessions WHERE telegram_user_id = '200'")).toEqual(cursorAfterNext);
			await runtime.bot.handleUpdate({ update_id: 4, callback_query: callback(4, oldNext) });
			expect(String(fake.lastMessage()?.text)).toContain("устарел");
			expect(await runtime.boundary.query("SELECT cursor_collaboration_id, revision FROM browse_sessions WHERE telegram_user_id = '200'")).toEqual(cursorAfterNext);

			await runtime.bot.handleUpdate({ update_id: 5, callback_query: callback(5, currentFilters) });
			await runtime.bot.handleUpdate({ update_id: 6, callback_query: callback(6, callbackData(fake, "b:f:t:")) });
			await runtime.bot.handleUpdate({ update_id: 7, callback_query: callback(7, callbackData(fake, "b:s:t:telegram_channel:")) });
			expect(String(fake.lastMessage()?.text)).toContain("Second browse card");
			expect(await runtime.boundary.query("SELECT target_profile_type_filter FROM browse_sessions WHERE telegram_user_id = '200'")).toEqual([{ target_profile_type_filter: "telegram_channel" }]);
			await runtime.bot.handleUpdate({ update_id: 8, callback_query: callback(8, callbackData(fake, "b:r:")) });
			expect(String(fake.lastMessage()?.text)).toContain("Second browse card");

			await runtime.shutdown();
			runtime = await createRuntime(databasePath, fake, clock);
			await runtime.bot.handleUpdate({ update_id: 9, message: privateMessage(9, "/feed") });
			expect(String(fake.lastMessage()?.text)).toContain("Подходящих карточек пока нет");
			await runtime.bot.handleUpdate({ update_id: 10, callback_query: callback(10, callbackData(fake, "b:r:")) });
			expect(String(fake.lastMessage()?.text)).toContain("Second browse card");

			await runtime.bot.handleUpdate({ update_id: 11, message: privateMessageForUser(11, 300, `/start c_${FIRST_TOKEN}`) });
			expect(String(fake.lastMessage()?.text)).toContain("First browse card");
			expect(callbackValues(fake)).toContain(`application:start:${FIRST_TOKEN}`);
			expect(await runtime.boundary.query("SELECT id FROM profiles WHERE telegram_user_id = '300'")).toEqual([]);
			await runtime.bot.handleUpdate({ update_id: 12, callback_query: callbackForUser(12, 300, `application:start:${FIRST_TOKEN}`) });
			expect(String(fake.lastMessage()?.text)).toContain("Отклик будет доступен на следующем этапе");

			await runtime.bot.handleUpdate({ update_id: 13, message: privateMessageForUser(13, 300, "/start c_short") });
			const neutral = String(fake.lastMessage()?.text);
			await runtime.bot.handleUpdate({ update_id: 14, message: privateMessageForUser(14, 300, `/start c_${"Z".repeat(22)}`) });
			expect(String(fake.lastMessage()?.text)).toBe(neutral);
			await runtime.bot.handleUpdate({ update_id: 15, message: privateMessageForUser(15, 300, `/start c_${HIDDEN_TOKEN}`) });
			expect(String(fake.lastMessage()?.text)).toBe(neutral);
			expect(neutral).toContain("Предложение недоступно");
		} finally {
			await runtime?.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

async function createRuntime(databasePath: string, fake: FakeTelegramApi, clock: FakeClock) {
	return createBotRuntime({
		bot: new Bot("fake-token", { client: { fetch: fake.fetch } }),
		config: {
			botToken: "fake-token", expectedBotId: "777", expectedBotUsername: "collab_bot", adminTelegramIds: [],
			showcaseChannelId: "-1001", showcaseChannelUsername: "showcase", databasePath,
			logLevel: "info", timeZone: "Asia/Yekaterinburg", helpContact: "@helpdesk",
		},
		migrationsDirectory,
		clock,
	});
}

async function seedCards(boundary: DatabaseBoundary): Promise<void> {
	for (const [userId, profileId] of [["100", "10000000-0000-4000-8000-000000000001"], ["101", "10100000-0000-4000-8000-000000000001"]] as const) {
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, ?, 'active', NULL, ?, ?)", [userId, `Author ${userId}`, NOW, NOW]);
		await boundary.execute("INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, 'blogger', ?, 'ekaterinburg', 'active', ?, ?, NULL)", [profileId, userId, `Author ${userId}`, NOW, NOW]);
		await boundary.execute("INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, 'website', ?, NULL, NULL, NULL, NULL)", [`${profileId.slice(0, 8)}-0000-4000-8000-000000000002`, profileId, `https://example.com/${userId}`]);
	}
	await insertCard(boundary, FIRST_ID, FIRST_TOKEN, "10000000-0000-4000-8000-000000000001", "First browse card", "blogger", "published", NOW + 200);
	await insertCard(boundary, SECOND_ID, SECOND_TOKEN, "10100000-0000-4000-8000-000000000001", "Second browse card", "any", "published", NOW + 100);
	await insertCard(boundary, "dddddddd-0000-4000-8000-000000000003", HIDDEN_TOKEN, "10000000-0000-4000-8000-000000000001", "Hidden browse card", "blogger", "hidden", NOW + 300);
}

async function insertCard(boundary: DatabaseBoundary, id: string, token: string, profileId: string, title: string, target: string, status: string, publishedAt: number): Promise<void> {
	await boundary.execute(
		"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at, published_at) VALUES (?, ?, ?, 'barter', ?, ?, 'Useful collaboration offer', 'Reliable partner expected', 2, ?, NULL, 'ekaterinburg', ?, 1, 0, ?, ?, ?)",
		[id, token, profileId, target, title, NOW + 86_400_000, status, NOW - 1000, NOW - 1000, publishedAt],
	);
	await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, 'city')", [id]);
}

function privateMessage(messageId: number, text: string): NonNullable<Update["message"]> { return privateMessageForUser(messageId, 200, text); }
function privateMessageForUser(messageId: number, userId: number, text: string): NonNullable<Update["message"]> {
	return { message_id: messageId, date: 1_700_000_000, chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false, first_name: `User ${userId}` }, text } as NonNullable<Update["message"]>;
}
function callback(id: number, data: string): NonNullable<Update["callback_query"]> { return callbackForUser(id, 200, data); }
function callbackForUser(id: number, userId: number, data: string): NonNullable<Update["callback_query"]> {
	return { id: `callback-${id}`, from: { id: userId, is_bot: false, first_name: `User ${userId}` }, message: { ...privateMessageForUser(id, userId, "") }, chat_instance: "instance", data } as NonNullable<Update["callback_query"]>;
}
function callbackValues(fake: FakeTelegramApi): string[] {
	return fake.lastMessage()?.reply_markup?.inline_keyboard?.flat().flatMap((button) => typeof (button as { callback_data?: unknown }).callback_data === "string" ? [(button as { callback_data: string }).callback_data] : []) ?? [];
}
function callbackData(fake: FakeTelegramApi, prefix: string): string {
	const value = callbackValues(fake).find((candidate) => candidate.startsWith(prefix));
	if (value === undefined) throw new Error(`callback ${prefix} was not rendered`);
	return value;
}
