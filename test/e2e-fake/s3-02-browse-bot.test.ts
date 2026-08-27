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
			expect(firstButtons.some((value) => value.startsWith(`application:start:f:${FIRST_TOKEN}`))).toBe(true);
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
			expect(callbackValues(fake)).toContain(`application:start:d:${FIRST_TOKEN}`);
			expect(await runtime.boundary.query("SELECT id FROM profiles WHERE telegram_user_id = '300'")).toEqual([]);

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

	it("starts from a full profile and persists one application plus one author DM under update replay", async () => {
		const fixture = await createSeededFixture("collaboration-s3-03-existing-profile-");
		const { directory, fake, runtime } = fixture;
		try {
			await seedApplicantProfile(runtime.boundary, "400", "40000000-0000-4000-8000-000000000001", "Existing Applicant");

			await runtime.bot.handleUpdate({ update_id: 1, message: privateMessageForUser(1, 400, "/feed") });
			const applicationStart = callbackData(fake, `application:start:f:${FIRST_TOKEN}`);
			await runtime.bot.handleUpdate({ update_id: 2, callback_query: callbackForUser(2, 400, applicationStart) });

			expect(await profileSessionState(runtime.boundary, "400")).toMatchObject({
				step: "application_message",
				continuation: { kind: "submit_application", collaborationId: FIRST_ID, source: "feed" },
			});
			expect(String(fake.lastMessage()?.text).toLowerCase()).toContain("сообщен");
			expect(callbackValues(fake).some((value) => value.startsWith("profile:back:"))).toBe(true);
			expect(callbackValues(fake).some((value) => value.startsWith("profile:cancel:"))).toBe(true);

			const applicationMessage = privateMessageForUser(3, 400, "Хочу сделать вместе полезный городской проект.");
			await runtime.bot.handleUpdate({ update_id: 3, message: applicationMessage });
			await runtime.bot.handleUpdate({ update_id: 3, message: applicationMessage });

			expect(await runtime.boundary.query("SELECT collaboration_id, applicant_profile_id, message, status FROM applications")).toEqual([{
				collaboration_id: FIRST_ID,
				applicant_profile_id: "40000000-0000-4000-8000-000000000001",
				message: "Хочу сделать вместе полезный городской проект.",
				status: "pending",
			}]);
			expect(await runtime.boundary.query("SELECT kind, recipient_chat_id FROM outbox_deliveries")).toEqual([{ kind: "dm_send", recipient_chat_id: "100" }]);
			expect(await runtime.boundary.query("SELECT command_id, status FROM command_receipts WHERE command_id = 'telegram:update:3'")).toEqual([{
				command_id: "telegram:update:3", status: "completed",
			}]);
			expect(await runtime.boundary.query("SELECT update_id, command_id FROM processed_updates WHERE update_id = 3")).toEqual([{
				update_id: 3, command_id: "telegram:update:3",
			}]);
			expect(JSON.stringify(await runtime.boundary.query("SELECT result_json FROM command_receipts WHERE command_id = 'telegram:update:3'"))).not.toContain("Хочу сделать вместе");
			expect(await profileSessionState(runtime.boundary, "400")).toBeUndefined();
		} finally {
			await runtime.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("keeps the quick profile resumable and supports Back plus Cancel before profile persistence", async () => {
		const fixture = await createSeededFixture("collaboration-s3-03-quick-resume-");
		const { databasePath, directory, fake, clock } = fixture;
		let { runtime } = fixture;
		try {
			await runtime.bot.handleUpdate({ update_id: 1, message: privateMessageForUser(1, 410, `/start c_${FIRST_TOKEN}`) });
			await runtime.bot.handleUpdate({ update_id: 2, callback_query: callbackForUser(2, 410, callbackData(fake, `application:start:d:${FIRST_TOKEN}`)) });
			expect(await profileSessionState(runtime.boundary, "410")).toMatchObject({
				step: "type",
				continuation: { kind: "submit_application", collaborationId: FIRST_ID, source: "deep_link" },
			});

			await runtime.bot.handleUpdate({ update_id: 3, callback_query: callbackForUser(3, 410, callbackData(fake, "profile:type:blogger")) });
			expect(await profileSessionState(runtime.boundary, "410")).toMatchObject({ step: "display_name" });
			await runtime.bot.handleUpdate({ update_id: 4, callback_query: callbackForUser(4, 410, callbackData(fake, "profile:back:")) });
			expect(await profileSessionState(runtime.boundary, "410")).toMatchObject({ step: "type", draft: { description: null, topics: [] } });

			await runtime.bot.handleUpdate({ update_id: 5, callback_query: callbackForUser(5, 410, callbackData(fake, "profile:type:blogger")) });
			await runtime.bot.handleUpdate({ update_id: 6, message: privateMessageForUser(6, 410, "Restarted Applicant") });
			expect(await profileSessionState(runtime.boundary, "410")).toMatchObject({ step: "platform" });

			await runtime.shutdown();
			runtime = await createRuntime(databasePath, fake, clock);
			await runtime.bot.handleUpdate({ update_id: 7, message: privateMessageForUser(7, 410, "/start") });
			await runtime.bot.handleUpdate({ update_id: 8, callback_query: callbackForUser(8, 410, callbackData(fake, "profile:resume")) });
			expect(await profileSessionState(runtime.boundary, "410")).toMatchObject({
				step: "platform",
				continuation: { kind: "submit_application", collaborationId: FIRST_ID, source: "deep_link" },
			});

			await runtime.bot.handleUpdate({ update_id: 9, message: privateMessageForUser(9, 410, "/cancel") });
			expect(await profileSessionState(runtime.boundary, "410")).toBeUndefined();
			expect(await runtime.boundary.query("SELECT id FROM profiles WHERE telegram_user_id = '410'")).toEqual([]);
			expect(await runtime.boundary.query("SELECT id FROM applications")).toEqual([]);
		} finally {
			await runtime.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("keeps a saved quick profile when Back or Cancel leaves application_message", async () => {
		const fixture = await createSeededFixture("collaboration-s3-03-quick-saved-");
		const { directory, fake, runtime } = fixture;
		try {
			await startQuickProfile(runtime, fake, 420, 1, "Saved Applicant", "https://example.com/saved-applicant");
			expect(await profileSessionState(runtime.boundary, "420")).toMatchObject({ step: "application_message" });
			const [savedProfile] = await runtime.boundary.query<{ id: string; type: string; display_name: string; description: string | null }>(
				"SELECT id, type, display_name, description FROM profiles WHERE telegram_user_id = '420' AND status = 'active'",
			);
			expect(savedProfile).toMatchObject({ type: "blogger", display_name: "Saved Applicant", description: null });
			expect(savedProfile).toBeDefined();
			if (savedProfile === undefined) throw new Error("quick profile was not persisted");
			expect(await runtime.boundary.query("SELECT topic FROM profile_topics WHERE profile_id = ?", [savedProfile.id])).toEqual([]);
			expect(await runtime.boundary.query("SELECT url, audience_size FROM profile_platforms WHERE profile_id = ?", [savedProfile.id])).toEqual([{
				url: "https://example.com/saved-applicant", audience_size: null,
			}]);

			await runtime.bot.handleUpdate({ update_id: 7, callback_query: callbackForUser(7, 420, callbackData(fake, "profile:back:")) });
			expect(String(fake.lastMessage()?.text)).toContain("First browse card");
			expect(await profileSessionState(runtime.boundary, "420")).toBeUndefined();
			expect(await runtime.boundary.query("SELECT id FROM profiles WHERE telegram_user_id = '420' AND status = 'active'")).toHaveLength(1);
			expect(await runtime.boundary.query("SELECT id FROM applications")).toEqual([]);

			await runtime.bot.handleUpdate({ update_id: 8, message: privateMessageForUser(8, 420, `/start c_${FIRST_TOKEN}`) });
			await runtime.bot.handleUpdate({ update_id: 9, callback_query: callbackForUser(9, 420, callbackData(fake, `application:start:d:${FIRST_TOKEN}`)) });
			expect(await profileSessionState(runtime.boundary, "420")).toMatchObject({ step: "application_message" });
			await runtime.bot.handleUpdate({ update_id: 10, callback_query: callbackForUser(10, 420, callbackData(fake, "profile:cancel:")) });
			expect(await profileSessionState(runtime.boundary, "420")).toBeUndefined();
			expect(await runtime.boundary.query("SELECT id FROM profiles WHERE telegram_user_id = '420' AND status = 'active'")).toHaveLength(1);
			expect(await runtime.boundary.query("SELECT id FROM applications")).toEqual([]);
		} finally {
			await runtime.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("keeps the quick profile but creates no application when the target turns stale before profile persistence", async () => {
		const fixture = await createSeededFixture("collaboration-s3-03-quick-stale-");
		const { directory, fake, runtime } = fixture;
		try {
			await startQuickProfileUntilPlatformUrl(runtime, fake, 430, 1, "Stale Target Applicant");
			await runtime.boundary.execute("UPDATE collaborations SET status = 'hidden', updated_at = ? WHERE id = ?", [NOW, FIRST_ID]);
			await runtime.bot.handleUpdate({ update_id: 6, message: privateMessageForUser(6, 430, "https://example.com/stale-target-applicant") });

			expect(await runtime.boundary.query("SELECT id FROM profiles WHERE telegram_user_id = '430' AND status = 'active'")).toHaveLength(1);
			expect(await runtime.boundary.query("SELECT id FROM applications")).toEqual([]);
			expect(await profileSessionState(runtime.boundary, "430")).toBeUndefined();
			expect(String(fake.lastMessage()?.text).toLowerCase()).toContain("недоступ");
		} finally {
			await runtime.shutdown();
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

async function createSeededFixture(prefix: string) {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	const databasePath = join(directory, "app.sqlite");
	const clock = new FakeClock(NOW);
	const fake = new FakeTelegramApi({
		token: "fake-token",
		botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
	});
	const runtime = await createRuntime(databasePath, fake, clock);
	await seedCards(runtime.boundary);
	return { directory, databasePath, clock, fake, runtime };
}

async function seedApplicantProfile(boundary: DatabaseBoundary, userId: string, profileId: string, displayName: string): Promise<void> {
	await boundary.execute(
		"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, ?, 'active', NULL, ?, ?)",
		[userId, displayName, NOW, NOW],
	);
	await boundary.execute(
		"INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, 'blogger', ?, 'ekaterinburg', 'active', ?, ?, NULL)",
		[profileId, userId, displayName, NOW, NOW],
	);
	await boundary.execute(
		"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, 'website', ?, NULL, NULL, NULL, NULL)",
		[`${profileId.slice(0, 8)}-0000-4000-8000-000000000002`, profileId, `https://example.com/applicants/${userId}`],
	);
}

async function profileSessionState(boundary: DatabaseBoundary, userId: string): Promise<Record<string, unknown> | undefined> {
	const [row] = await boundary.query<{ state_json: string }>("SELECT state_json FROM profile_sessions WHERE telegram_user_id = ?", [userId]);
	return row === undefined ? undefined : JSON.parse(row.state_json) as Record<string, unknown>;
}

async function startQuickProfile(
	runtime: Awaited<ReturnType<typeof createBotRuntime>>,
	fake: FakeTelegramApi,
	userId: number,
	firstUpdateId: number,
	displayName: string,
	platformUrl: string,
): Promise<void> {
	await startQuickProfileUntilPlatformUrl(runtime, fake, userId, firstUpdateId, displayName);
	await runtime.bot.handleUpdate({ update_id: firstUpdateId + 5, message: privateMessageForUser(firstUpdateId + 5, userId, platformUrl) });
}

async function startQuickProfileUntilPlatformUrl(
	runtime: Awaited<ReturnType<typeof createBotRuntime>>,
	fake: FakeTelegramApi,
	userId: number,
	firstUpdateId: number,
	displayName: string,
): Promise<void> {
	await runtime.bot.handleUpdate({ update_id: firstUpdateId, message: privateMessageForUser(firstUpdateId, userId, `/start c_${FIRST_TOKEN}`) });
	await runtime.bot.handleUpdate({ update_id: firstUpdateId + 1, callback_query: callbackForUser(firstUpdateId + 1, userId, callbackData(fake, `application:start:d:${FIRST_TOKEN}`)) });
	await runtime.bot.handleUpdate({ update_id: firstUpdateId + 2, callback_query: callbackForUser(firstUpdateId + 2, userId, callbackData(fake, "profile:type:blogger")) });
	await runtime.bot.handleUpdate({ update_id: firstUpdateId + 3, message: privateMessageForUser(firstUpdateId + 3, userId, displayName) });
	await runtime.bot.handleUpdate({ update_id: firstUpdateId + 4, callback_query: callbackForUser(firstUpdateId + 4, userId, callbackData(fake, "profile:platform:other")) });
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
	if (status === "published") {
		await boundary.execute(
			"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', ?, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
			[id, id === FIRST_ID ? 41 : 42, "a".repeat(64), publishedAt],
		);
	}
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
