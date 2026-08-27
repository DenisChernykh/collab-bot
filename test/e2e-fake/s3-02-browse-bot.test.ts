import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { BotRuntime } from "../../src/runtime/bot-runtime.js";
import type { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import type { FakeTelegramApi } from "../support/fake-telegram-api.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import { createFakeBotRuntime } from "../support/fake-bot-runtime.js";
import {
	callbackData,
	callbackForUser,
	callbackValues,
	createFakeTelegramApi,
	privateMessageForUser,
} from "../support/fake-telegram.js";

const NOW = 1_700_000_000_000;
const FIRST_ID = "ffffffff-0000-4000-8000-000000000003";
const SECOND_ID = "eeeeeeee-0000-4000-8000-000000000003";
const FIRST_TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";
const SECOND_TOKEN = "BBBBBBBBBBBBBBBBBBBBBB";
const HIDDEN_TOKEN = "CCCCCCCCCCCCCCCCCCCCCC";
const MANUAL_CLOSE_APPLICANT_PROFILE_ID = "50100000-0000-4000-8000-000000000001";
const REJECTED_APPLICANT_PROFILE_ID = "51000000-0000-4000-8000-000000000001";
const CLOSED_APPLICATION_ID = "50100000-0000-4000-8000-000000000004";
const REJECTED_APPLICATION_ID = "51000000-0000-4000-8000-000000000004";
const INVALID_IDENTITY_CARD_ID = "cccccccc-0000-4000-8000-000000000003";
const INVALID_IDENTITY_TOKEN = "DDDDDDDDDDDDDDDDDDDDDD";

describe("S3-02 fake Telegram browse journey", () => {
	it("wires menu, revision-safe feed, filters, restart and strict deep links through the real runtime composition", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-02-browse-e2e-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(NOW);
		const fake = createFakeTelegramApi();
		let runtime: BotRuntime | undefined;
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

	it("does not offer or accept the personal Telegram platform opt-in without a public username", async () => {
		const fixture = await createSeededFixture("collaboration-s3-03-no-personal-username-");
		const { directory, fake, runtime } = fixture;
		try {
			await runtime.bot.handleUpdate({ update_id: 1, message: privateMessageForUser(1, 415, `/start c_${FIRST_TOKEN}`) });
			await runtime.bot.handleUpdate({ update_id: 2, callback_query: callbackForUser(2, 415, callbackData(fake, `application:start:d:${FIRST_TOKEN}`)) });
			await runtime.bot.handleUpdate({ update_id: 3, callback_query: callbackForUser(3, 415, callbackData(fake, "profile:type:blogger")) });
			await runtime.bot.handleUpdate({ update_id: 4, message: privateMessageForUser(4, 415, "No Username Applicant") });

			expect(callbackValues(fake).some((value) => value.startsWith("profile:platform:self"))).toBe(false);
			const [session] = await runtime.boundary.query<{ state_json: string; revision: number }>("SELECT state_json, revision FROM profile_sessions WHERE telegram_user_id = '415'");
			expect(session).toBeDefined();
			if (session === undefined) throw new Error("profile session was not created");
			const state = JSON.parse(session.state_json) as { generation: string };
			const forged = `profile:platform:self:g${state.generation}:r${session.revision}`;
			await runtime.bot.handleUpdate({ update_id: 5, callback_query: callbackForUser(5, 415, forged) });

			expect(String(fake.lastMessage()?.text)).toContain("публичного @username");
			expect(await profileSessionState(runtime.boundary, "415")).toMatchObject({ step: "platform" });
			expect(await runtime.boundary.query("SELECT id FROM profiles WHERE telegram_user_id = '415'")).toEqual([]);
		} finally {
			await runtime.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("persists an explicitly selected personal Telegram platform in the quick application flow", async () => {
		const fixture = await createSeededFixture("collaboration-s3-03-personal-username-");
		const { directory, fake, runtime } = fixture;
		try {
			await runtime.bot.handleUpdate({ update_id: 1, message: privateMessageForUser(1, 416, `/start c_${FIRST_TOKEN}`, "quick_creator") });
			await runtime.bot.handleUpdate({ update_id: 2, callback_query: callbackForUser(2, 416, callbackData(fake, `application:start:d:${FIRST_TOKEN}`), "quick_creator") });
			await runtime.bot.handleUpdate({ update_id: 3, callback_query: callbackForUser(3, 416, callbackData(fake, "profile:type:blogger"), "quick_creator") });
			await runtime.bot.handleUpdate({ update_id: 4, message: privateMessageForUser(4, 416, "Quick Telegram Applicant", "quick_creator") });
			expect(fake.lastMessage()?.reply_markup?.inline_keyboard?.flat()).toContainEqual(expect.objectContaining({ text: "Использовать @quick_creator" }));
			await runtime.bot.handleUpdate({ update_id: 5, callback_query: callbackForUser(5, 416, callbackData(fake, "profile:platform:self"), "quick_creator") });

			expect(await profileSessionState(runtime.boundary, "416")).toMatchObject({ step: "application_message" });
			expect(await runtime.boundary.query("SELECT pp.url, pp.username FROM profile_platforms pp JOIN profiles p ON p.id = pp.profile_id WHERE p.telegram_user_id = '416' AND p.status = 'active'")).toEqual([{
				url: "https://t.me/quick_creator", username: "quick_creator",
			}]);
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
			await runtime.boundary.execute(
				"UPDATE collaborations SET hidden_from_status = status, status = 'hidden', hidden_at = ?, projection_revision = projection_revision + 1, updated_at = ? WHERE id = ?",
				[NOW, NOW, FIRST_ID],
			);
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

	it("runs the complete shareable checkpoint through accept, reject, admin hide and restart", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s3-checkpoint-e2e-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(NOW);
		const fake = createFakeTelegramApi();
		let runtime: BotRuntime | undefined;
		try {
			runtime = await createRuntime(databasePath, fake, clock, { adminTelegramIds: ["900"] });
			await runtime.start();

			await runtime.bot.handleUpdate({ update_id: 1001, message: privateMessageForUser(1001, 600, "/start", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1002, callback_query: callbackForUser(1002, 600, callbackData(fake, "collaboration:start"), "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1003, callback_query: callbackForUser(1003, 600, callbackData(fake, "profile:type:blogger"), "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1004, message: privateMessageForUser(1004, 600, "Stage Author", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1005, message: privateMessageForUser(1005, 600, "Город", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1006, message: privateMessageForUser(1006, 600, "Автор городских совместных проектов.", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1007, callback_query: callbackForUser(1007, 600, callbackData(fake, "profile:platform:other"), "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1008, message: privateMessageForUser(1008, 600, "https://example.com/stage-author", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1009, message: privateMessageForUser(1009, 600, "1000", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1010, callback_query: callbackForUser(1010, 600, callbackData(fake, "profile:apply"), "full_author") });

			await runtime.bot.handleUpdate({ update_id: 1011, callback_query: callbackForUser(1011, 600, callbackData(fake, "collaboration:format:joint_content"), "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1012, callback_query: callbackForUser(1012, 600, callbackData(fake, "collaboration:target:blogger"), "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1013, message: privateMessageForUser(1013, 600, "Город", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1014, message: privateMessageForUser(1014, 600, "Полный S3 checkpoint", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1015, message: privateMessageForUser(1015, 600, "Сделаем полезный городской материал вместе.", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1016, message: privateMessageForUser(1016, 600, "Нужны два надёжных партнёра для съёмки.", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1017, message: privateMessageForUser(1017, 600, "2", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1018, message: privateMessageForUser(1018, 600, "20.11.2023", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1019, message: privateMessageForUser(1019, 600, "25.11.2023", "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1020, callback_query: callbackForUser(1020, 600, callbackData(fake, "collaboration:publish"), "full_author") });

			await waitUntil(async () => (await runtime!.boundary.query<{ status: string }>(
				"SELECT status FROM collaborations WHERE author_profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '600')",
			))[0]?.status === "published");
			const [published] = await runtime.boundary.query<{ id: string; public_token: string; projection_revision: number }>(
				"SELECT id, public_token, projection_revision FROM collaborations WHERE author_profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '600')",
			);
			expect(published).toBeDefined();
			if (published === undefined) throw new Error("checkpoint card was not published");
			expect(published.public_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
			expect(published.projection_revision).toBe(2);
			expect(fake.calls.filter((call) => call.method === "sendMessage" && String(call.payload.chat_id) === "-1001")).toHaveLength(1);

			await submitQuickApplication(runtime, fake, {
				userId: 610, username: "first_candidate", firstUpdateId: 1100,
				publicToken: published.public_token, displayName: "First quick candidate",
				platformUrl: "https://example.com/first-quick", message: "Первый кандидат готов участвовать в городском проекте.",
			});
			await submitQuickApplication(runtime, fake, {
				userId: 611, username: "second_candidate", firstUpdateId: 1120,
				publicToken: published.public_token, displayName: "Second quick candidate",
				platformUrl: "https://example.com/second-quick", message: "Второй кандидат предлагает помощь со съёмкой проекта.",
			});
			await submitQuickApplication(runtime, fake, {
				userId: 612, username: "rejected_candidate", firstUpdateId: 1140,
				publicToken: published.public_token, displayName: "Rejected quick candidate",
				platformUrl: "https://example.com/rejected-quick", message: "Третий кандидат проверяет сохранённый отказ автора.",
			});
			expect(await runtime.boundary.query(
				"SELECT status, count(*) AS count FROM applications WHERE collaboration_id = ? GROUP BY status",
				[published.id],
			)).toEqual([{ status: "pending", count: 3 }]);

			let managementStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 1200, message: privateMessageForUser(1200, 600, `/start c_${published.public_token}`, "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1201, callback_query: callbackForUser(1201, 600, callbackDataForButtonSince(fake, "Отказать", managementStart), "full_author") });

			managementStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 1202, message: privateMessageForUser(1202, 600, `/start c_${published.public_token}`, "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1203, callback_query: callbackForUser(1203, 600, callbackDataForButtonSince(fake, "Принять", managementStart), "full_author") });

			managementStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 1204, message: privateMessageForUser(1204, 600, `/start c_${published.public_token}`, "full_author") });
			await runtime.bot.handleUpdate({ update_id: 1205, callback_query: callbackForUser(1205, 600, callbackDataForButtonSince(fake, "Принять", managementStart), "full_author") });

			expect(await runtime.boundary.query(
				"SELECT status, count(*) AS count FROM applications WHERE collaboration_id = ? GROUP BY status ORDER BY status",
				[published.id],
			)).toEqual([{ status: "accepted", count: 2 }, { status: "rejected", count: 1 }]);
			const matchedProjectionRevision = published.projection_revision + 2;
			expect(await runtime.boundary.query(
				"SELECT status, projection_revision, matched_at FROM collaborations WHERE id = ?",
				[published.id],
			)).toEqual([{ status: "matched", projection_revision: matchedProjectionRevision, matched_at: NOW }]);
			await waitUntil(async () => (await runtime!.boundary.query<{ status: string }>(
				"SELECT status FROM outbox_deliveries WHERE idempotency_key = ?",
				[`channel:${published.id}:projection:${matchedProjectionRevision}`],
			))[0]?.status === "sent", 6_000);
			expect(fake.calls.some((call) => call.method === "editMessageText" && String(call.payload.text).includes("Набор завершён"))).toBe(true);

			const acceptedUsers = await runtime.boundary.query<{ telegram_user_id: string }>(
				`SELECT p.telegram_user_id
				 FROM applications a
				 JOIN profiles p ON p.id = a.applicant_profile_id
				 WHERE a.collaboration_id = ? AND a.status = 'accepted'
				 ORDER BY p.telegram_user_id`,
				[published.id],
			);
			expect(acceptedUsers).toHaveLength(2);
			for (const [index, accepted] of acceptedUsers.entries()) {
				const viewStart = fake.calls.length;
				await runtime.bot.handleUpdate({
					update_id: 1210 + index,
					message: privateMessageForUser(1210 + index, Number(accepted.telegram_user_id), "/my_applications"),
				});
				expect(messagesSince(fake, viewStart).join("\n").toLowerCase()).toContain("принят");
				expect(urlValuesSince(fake, viewStart)).toContain("https://t.me/full_author");
			}
			const authorListStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 1220, message: privateMessageForUser(1220, 600, "/my_collaborations", "full_author") });
			expect(messagesSince(fake, authorListStart).join("\n").toLowerCase()).toContain("совпадение");

			const cardLink = `https://t.me/collab_bot?start=c_${published.public_token}`;
			const adminLookupStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 1221, message: privateMessageForUser(1221, 900, `/admin ${cardLink}`) });
			expect(messagesSince(fake, adminLookupStart).join("\n")).toContain("Полный S3 checkpoint");
			await runtime.bot.handleUpdate({ update_id: 1222, message: privateMessageForUser(1222, 900, `/admin hide ${cardLink} Конец полного fake checkpoint`) });
			await waitUntil(async () => (await runtime!.boundary.query<{ status: string }>(
				"SELECT status FROM outbox_deliveries WHERE idempotency_key = ?",
				[`channel:${published.id}:hide:${matchedProjectionRevision + 1}`],
			))[0]?.status === "sent", 6_000);
			expect(await runtime.boundary.query("SELECT status, hidden_from_status, projection_revision FROM collaborations WHERE id = ?", [published.id])).toEqual([{
				status: "hidden",
				hidden_from_status: "matched",
				projection_revision: matchedProjectionRevision + 1,
			}]);
			const contactAfterHideStart = fake.calls.length;
			await runtime.bot.handleUpdate({
				update_id: 1223,
				message: privateMessageForUser(1223, Number(acceptedUsers[0]!.telegram_user_id), "/my_applications"),
			});
			expect(urlValuesSince(fake, contactAfterHideStart)).toContain("https://t.me/full_author");

			const beforeRestart = await runtime.boundary.query(
				"SELECT (SELECT count(*) FROM applications WHERE collaboration_id = ?) AS applications, (SELECT count(*) FROM outbox_deliveries) AS deliveries, (SELECT count(*) FROM operator_actions) AS operator_actions",
				[published.id],
			);
			await runtime.shutdown();
			runtime = await createRuntime(databasePath, fake, clock, { adminTelegramIds: ["900"] });
			const restartStart = fake.calls.length;
			await runtime.bot.handleUpdate({
				update_id: 1230,
				message: privateMessageForUser(1230, Number(acceptedUsers[0]!.telegram_user_id), "/my_applications"),
			});
			expect(messagesSince(fake, restartStart).join("\n").toLowerCase()).toContain("принят");
			expect(urlValuesSince(fake, restartStart)).toContain("https://t.me/full_author");
			expect(await runtime.boundary.query(
				"SELECT (SELECT count(*) FROM applications WHERE collaboration_id = ?) AS applications, (SELECT count(*) FROM outbox_deliveries) AS deliveries, (SELECT count(*) FROM operator_actions) AS operator_actions",
				[published.id],
			)).toEqual(beforeRestart);
		} finally {
			await runtime?.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);

	it("routes actor-bound cb actions outside the generic wrapper and preserves accept, manual close, pair contacts, replay and restart", async () => {
		const fixture = await createSeededFixture("collaboration-s3-04-accept-e2e-");
		const { databasePath, directory, fake, clock } = fixture;
		let { runtime } = fixture;
		try {
			await seedApplicantProfile(runtime.boundary, "500", "50000000-0000-4000-8000-000000000001", "First Applicant");
			await seedApplicantProfile(runtime.boundary, "501", MANUAL_CLOSE_APPLICANT_PROFILE_ID, "Second Applicant");

			await runtime.bot.handleUpdate({ update_id: 101, message: privateMessageForUser(101, 500, `/start c_${FIRST_TOKEN}`, "first_applicant") });
			await runtime.bot.handleUpdate({ update_id: 102, callback_query: callbackForUser(102, 500, callbackData(fake, `application:start:d:${FIRST_TOKEN}`), "first_applicant") });
			await runtime.bot.handleUpdate({ update_id: 103, message: privateMessageForUser(103, 500, "Готов сделать полезный совместный материал.", "first_applicant") });
			const [submitted] = await runtime.boundary.query<{ id: string }>(
				"SELECT id FROM applications WHERE applicant_profile_id = '50000000-0000-4000-8000-000000000001'",
			);
			expect(submitted).toBeDefined();
			if (submitted === undefined) throw new Error("application was not persisted");

			const managementStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 104, message: privateMessageForUser(104, 100, `/start c_${FIRST_TOKEN}`, "author_public") });
			const accept = callbackDataForButtonSince(fake, "Принять", managementStart);
			const reject = callbackDataForButtonSince(fake, "Отказать", managementStart);
			expect([accept, reject]).toEqual([expect.stringMatching(/^cb_[A-Za-z0-9_-]+$/), expect.stringMatching(/^cb_[A-Za-z0-9_-]+$/)]);
			expect([accept, reject].every((value) => Buffer.byteLength(value, "utf8") <= 64)).toBe(true);
			const actionRows = await runtime.boundary.query<{ token_hash: string; actor_telegram_user_id: string; action_type: string }>(
				"SELECT token_hash, actor_telegram_user_id, action_type FROM telegram_actions ORDER BY action_type, token_hash",
			);
			expect(actionRows).toEqual(expect.arrayContaining([
				expect.objectContaining({ actor_telegram_user_id: "100", action_type: "application.accept" }),
				expect.objectContaining({ actor_telegram_user_id: "100", action_type: "application.reject" }),
			]));
			expect(JSON.stringify(actionRows)).not.toContain(accept);
			expect(JSON.stringify(actionRows)).not.toContain(reject);

			await runtime.bot.handleUpdate({ update_id: 105, callback_query: callbackForUser(105, 101, accept, "foreign_author") });
			expect(await applicationStatus(runtime.boundary, submitted.id)).toBe("pending");
			expect(messagesSince(fake, managementStart).join("\n").toLowerCase()).toMatch(/недоступ|неактуал/);

			const acceptUpdate = { update_id: 106, callback_query: callbackForUser(106, 100, accept, "author_public") } as const;
			await runtime.bot.handleUpdate(acceptUpdate);
			await runtime.bot.handleUpdate(acceptUpdate);
			await runtime.bot.handleUpdate({ update_id: 107, callback_query: callbackForUser(107, 100, accept, "author_public") });
			expect(await runtime.boundary.query(
				"SELECT status, decided_by_profile_id, decided_at FROM applications WHERE id = ?",
				[submitted.id],
			)).toEqual([{
				status: "accepted",
				decided_by_profile_id: "10000000-0000-4000-8000-000000000001",
				decided_at: NOW,
			}]);
			expect(await runtime.boundary.query("SELECT status, projection_revision FROM collaborations WHERE id = ?", [FIRST_ID])).toEqual([{
				status: "published", projection_revision: 1,
			}]);
			const acceptEffects = await runtime.boundary.query<{ idempotency_key: string; payload_json: string }>(
				"SELECT idempotency_key, payload_json FROM outbox_deliveries WHERE idempotency_key LIKE ? ORDER BY idempotency_key",
				[`application:${submitted.id}:%`],
			);
			expect(new Set(acceptEffects.map((row) => row.idempotency_key)).size).toBe(acceptEffects.length);
			expect(acceptEffects.map((row) => row.idempotency_key).filter((key) => key.includes("accepted"))).toHaveLength(2);
			expect(acceptEffects.every((row) => !row.payload_json.includes("callback_data"))).toBe(true);
			expect(await runtime.boundary.query(
				"SELECT count(*) AS count FROM outbox_deliveries WHERE kind = 'channel_edit' AND idempotency_key = ?",
				[`channel:${FIRST_ID}:projection:1`],
			)).toEqual([{ count: 1 }]);
			expect(await runtime.boundary.query("SELECT status FROM command_receipts WHERE command_id = 'telegram:update:106'")).toEqual([{ status: "completed" }]);
			expect(await runtime.boundary.query("SELECT update_id FROM processed_updates WHERE update_id = 106")).toEqual([{ update_id: 106 }]);
			await insertApplication(runtime.boundary, {
				id: CLOSED_APPLICATION_ID,
				applicantProfileId: MANUAL_CLOSE_APPLICANT_PROFILE_ID,
				message: "Второй кандидат ожидает решения автора.",
				createdAt: NOW + 1,
			});

			const applicantViewStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 108, message: privateMessageForUser(108, 500, "/my_applications", "first_applicant") });
			expect(messagesSince(fake, applicantViewStart).join("\n").toLowerCase()).toContain("принят");
			expect(urlValuesSince(fake, applicantViewStart)).toContain("https://t.me/author_public");
			expect(messagesSince(fake, applicantViewStart).join("\n")).not.toContain("Second Applicant");
			expect(urlValuesSince(fake, applicantViewStart).join("\n")).not.toContain("second_applicant");

			const closeViewStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 109, message: privateMessageForUser(109, 100, `/start c_${FIRST_TOKEN}`, "author_public") });
			const closeRecruitment = callbackDataForButtonSince(fake, "Завершить набор", closeViewStart);
			expect(closeRecruitment).toMatch(/^cb_[A-Za-z0-9_-]+$/);
			await runtime.bot.handleUpdate({ update_id: 110, callback_query: callbackForUser(110, 100, closeRecruitment, "author_public") });
			expect(await runtime.boundary.query("SELECT status, matched_at, projection_revision FROM collaborations WHERE id = ?", [FIRST_ID])).toEqual([{
				status: "matched", matched_at: NOW, projection_revision: 2,
			}]);
			expect(await runtime.boundary.query("SELECT id, status FROM applications WHERE collaboration_id = ? ORDER BY id", [FIRST_ID])).toEqual([
				{ id: CLOSED_APPLICATION_ID, status: "closed" },
				{ id: submitted.id, status: "accepted" },
			].sort((left, right) => left.id.localeCompare(right.id)));
			expect(await runtime.boundary.query(
				"SELECT count(*) AS count FROM outbox_deliveries WHERE kind = 'channel_edit' AND idempotency_key = ?",
				[`channel:${FIRST_ID}:projection:2`],
			)).toEqual([{ count: 1 }]);

			const closedViewStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 111, message: privateMessageForUser(111, 501, "/my_applications", "second_applicant") });
			expect(messagesSince(fake, closedViewStart).join("\n").toLowerCase()).toContain("закрыт");
			expect(urlValuesSince(fake, closedViewStart)).toEqual([]);

			await runtime.shutdown();
			runtime = await createRuntime(databasePath, fake, clock);
			const restartViewStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 112, message: privateMessageForUser(112, 500, "/my_applications", "first_applicant") });
			expect(messagesSince(fake, restartViewStart).join("\n").toLowerCase()).toContain("принят");
			expect(urlValuesSince(fake, restartViewStart)).toContain("https://t.me/author_public");
		} finally {
			await runtime.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("keeps stale decision buttons inert, rejects exactly once, and reports the persisted result", async () => {
		const fixture = await createSeededFixture("collaboration-s3-04-reject-e2e-");
		const { directory, fake, runtime } = fixture;
		try {
			await seedApplicantProfile(runtime.boundary, "510", REJECTED_APPLICANT_PROFILE_ID, "Rejected Applicant");
			await insertApplication(runtime.boundary, {
				id: REJECTED_APPLICATION_ID,
				applicantProfileId: REJECTED_APPLICANT_PROFILE_ID,
				message: "Этот отклик будет отклонён автором.",
			});

			let managementStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 201, message: privateMessageForUser(201, 100, `/start c_${FIRST_TOKEN}`, "author_public") });
			const staleAccept = callbackDataForButtonSince(fake, "Принять", managementStart);
			await runtime.boundary.execute("UPDATE collaborations SET projection_revision = projection_revision + 1 WHERE id = ?", [FIRST_ID]);
			await runtime.bot.handleUpdate({ update_id: 202, callback_query: callbackForUser(202, 100, staleAccept, "author_public") });
			expect(await applicationStatus(runtime.boundary, REJECTED_APPLICATION_ID)).toBe("pending");
			expect(String(fake.lastMessage()?.text).toLowerCase()).toMatch(/устар|неактуал/);

			managementStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 203, message: privateMessageForUser(203, 100, `/start c_${FIRST_TOKEN}`, "author_public") });
			const reject = callbackDataForButtonSince(fake, "Отказать", managementStart);
			const rejectUpdate = { update_id: 204, callback_query: callbackForUser(204, 100, reject, "author_public") } as const;
			await runtime.bot.handleUpdate(rejectUpdate);
			await runtime.bot.handleUpdate(rejectUpdate);
			await runtime.bot.handleUpdate({ update_id: 205, callback_query: callbackForUser(205, 100, reject, "author_public") });
			expect(await runtime.boundary.query(
				"SELECT status, decided_by_profile_id, decided_at FROM applications WHERE id = ?",
				[REJECTED_APPLICATION_ID],
			)).toEqual([{
				status: "rejected",
				decided_by_profile_id: "10000000-0000-4000-8000-000000000001",
				decided_at: NOW,
			}]);
			expect(await runtime.boundary.query(
				"SELECT count(*) AS count FROM outbox_deliveries WHERE idempotency_key = ?",
				[`application:${REJECTED_APPLICATION_ID}:rejected:v1`],
			)).toEqual([{ count: 1 }]);
			expect(await runtime.boundary.query("SELECT status, projection_revision FROM collaborations WHERE id = ?", [FIRST_ID])).toEqual([{
				status: "published", projection_revision: 1,
			}]);

			const viewStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 206, message: privateMessageForUser(206, 510, "/my_applications", "rejected_applicant") });
			expect(messagesSince(fake, viewStart).join("\n").toLowerCase()).toContain("отклон");
			expect(urlValuesSince(fake, viewStart)).toEqual([]);
		} finally {
			await runtime.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("uses a current username, falls back to a positive decimal user ID, and fails closed for a corrupt pair identity", async () => {
		const fixture = await createSeededFixture("collaboration-s3-04-contact-e2e-");
		const { directory, fake, runtime } = fixture;
		try {
			await seedApplicantProfile(runtime.boundary, "520", "52000000-0000-4000-8000-000000000001", "ID Fallback Applicant");
			await insertApplication(runtime.boundary, {
				id: "52000000-0000-4000-8000-000000000004",
				applicantProfileId: "52000000-0000-4000-8000-000000000001",
				message: "Этот отклик уже принят для проверки fallback.",
				status: "accepted",
				decidedByProfileId: "10000000-0000-4000-8000-000000000001",
				decidedAt: NOW,
			});

			const fallbackStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 301, message: privateMessageForUser(301, 520, "/my_applications", "fallback_applicant") });
			expect(urlValuesSince(fake, fallbackStart)).toContain("tg://user?id=100");

			await runtime.boundary.execute(
				"INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES ('0', 'bad username', 'Corrupt identity', 'active', NULL, ?, ?)",
				[NOW, NOW],
			);
			await runtime.boundary.execute(
				"INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES ('00000000-0000-4000-8000-000000000001', '0', 'blogger', 'Corrupt identity author', 'ekaterinburg', 'active', ?, ?, NULL)",
				[NOW, NOW],
			);
			await runtime.boundary.execute(
				"INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'website', 'https://example.com/corrupt', NULL, NULL, NULL, NULL)",
			);
			await insertCard(runtime.boundary, INVALID_IDENTITY_CARD_ID, INVALID_IDENTITY_TOKEN, "00000000-0000-4000-8000-000000000001", "Invalid identity card", "blogger", "published", NOW + 400);
			await seedApplicantProfile(runtime.boundary, "521", "52100000-0000-4000-8000-000000000001", "Fail Closed Applicant");
			await insertApplication(runtime.boundary, {
				id: "52100000-0000-4000-8000-000000000004",
				collaborationId: INVALID_IDENTITY_CARD_ID,
				applicantProfileId: "52100000-0000-4000-8000-000000000001",
				message: "Контакт повреждён и не должен раскрываться.",
				status: "accepted",
				decidedByProfileId: "00000000-0000-4000-8000-000000000001",
				decidedAt: NOW,
			});
			const failClosedStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 302, message: privateMessageForUser(302, 521, "/my_applications", "fail_closed_applicant") });
			const failClosedText = messagesSince(fake, failClosedStart).join("\n").toLowerCase();
			expect(failClosedText).toMatch(/контакт.*недоступ|не удалось.*контакт/);
			expect(urlValuesSince(fake, failClosedStart)).toEqual([]);
			expect(messagesSince(fake, failClosedStart).join("\n")).not.toContain("bad username");
			expect(messagesSince(fake, failClosedStart).join("\n")).not.toMatch(/\b0\b/);
		} finally {
			await runtime.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("S4-01 fake Telegram admin hide journey", () => {
	it("hides through allowlisted commands, deletes after commit and preserves accepted contact across restart", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s4-admin-hide-e2e-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(NOW);
		const fake = createFakeTelegramApi();
		let runtime: BotRuntime | undefined;
		try {
			runtime = await createRuntime(databasePath, fake, clock, { adminTelegramIds: ["900"] });
			await runtime.start();
			await seedCards(runtime.boundary);
			await seedApplicantProfile(runtime.boundary, "300", "30000000-0000-4000-8000-000000000001", "Accepted applicant");
			await seedApplicantProfile(runtime.boundary, "301", "30100000-0000-4000-8000-000000000001", "Pending applicant");
			await insertApplication(runtime.boundary, {
				id: "30000000-0000-4000-8000-000000000004",
				applicantProfileId: "30000000-0000-4000-8000-000000000001",
				message: "Принятый кандидат сохраняет право на контакт.",
				status: "accepted",
				decidedByProfileId: "10000000-0000-4000-8000-000000000001",
				decidedAt: NOW,
			});
			await insertApplication(runtime.boundary, {
				id: "30100000-0000-4000-8000-000000000004",
				applicantProfileId: "30100000-0000-4000-8000-000000000001",
				message: "Ожидающий кандидат должен быть закрыт при hide.",
			});

			const link = `https://t.me/collab_bot?start=c_${FIRST_TOKEN}`;
			await runtime.bot.handleUpdate({ update_id: 1, message: privateMessageForUser(1, 400, `/start c_${FIRST_TOKEN}`) });
			const staleApply = callbackData(fake, `application:start:d:${FIRST_TOKEN}`);

			const outsiderStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 2, message: privateMessageForUser(2, 901, `/admin ${link}`) });
			const outsiderText = messagesSince(fake, outsiderStart).join("\n");
			expect(outsiderText).toContain("Не удалось распознать команду");
			expect(outsiderText).not.toContain("First browse card");

			const lookupStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 3, message: privateMessageForUser(3, 900, `/admin ${link}`) });
			const lookupText = messagesSince(fake, lookupStart).join("\n");
			expect(lookupText).toContain("First browse card");
			expect(lookupText).toContain("опубликована");
			expect(lookupText).not.toContain(FIRST_ID);
			expect(lookupText).not.toContain(FIRST_TOKEN);

			const reason = "Ручная модерация тестовой карточки";
			const hideStart = fake.calls.length;
			const hideMessage = privateMessageForUser(4, 900, `/admin hide ${link} ${reason}`);
			await runtime.bot.handleUpdate({ update_id: 4, message: hideMessage });
			await runtime.bot.handleUpdate({ update_id: 4, message: hideMessage });
			await waitUntil(async () => fake.calls.some((call) => call.method === "deleteMessage"));
			const hideText = messagesSince(fake, hideStart).join("\n");
			expect(hideText).toContain("Карточка скрыта");
			expect(hideText).not.toContain(reason);
			expect(hideText).not.toContain(FIRST_TOKEN);
			expect(fake.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(1);
			expect(fake.calls.find((call) => call.method === "deleteMessage")?.payload).toMatchObject({ chat_id: "-1001", message_id: 41 });

			expect(await runtime.boundary.query("SELECT status, hidden_from_status, projection_revision FROM collaborations WHERE id = ?", [FIRST_ID])).toEqual([{
				status: "hidden",
				hidden_from_status: "published",
				projection_revision: 1,
			}]);
			expect(await runtime.boundary.query("SELECT status FROM applications WHERE collaboration_id = ? ORDER BY id", [FIRST_ID])).toEqual([{ status: "accepted" }, { status: "closed" }]);
			expect(await runtime.boundary.query("SELECT action_type, actor_telegram_user_id, reason FROM operator_actions")).toEqual([{
				action_type: "hide_collaboration",
				actor_telegram_user_id: "900",
				reason,
			}]);
			expect(await runtime.boundary.query("SELECT status, attempt_count FROM outbox_deliveries WHERE kind = 'channel_delete'")).toEqual([{ status: "sent", attempt_count: 1 }]);

			await runtime.bot.handleUpdate({ update_id: 5, callback_query: callbackForUser(5, 400, staleApply) });
			expect(String(fake.lastMessage()?.text)).toContain("Предложение недоступно");
			expect(await runtime.boundary.query("SELECT telegram_user_id FROM profile_sessions WHERE telegram_user_id = '400'")).toEqual([]);
			await runtime.bot.handleUpdate({ update_id: 6, message: privateMessageForUser(6, 400, `/start c_${FIRST_TOKEN}`) });
			expect(String(fake.lastMessage()?.text)).toContain("Предложение недоступно");

			const authorStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 7, message: privateMessageForUser(7, 100, "/my_collaborations") });
			expect(messagesSince(fake, authorStart).join("\n")).toContain("скрыта");
			const applicantStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 8, message: privateMessageForUser(8, 300, "/my_applications") });
			expect(messagesSince(fake, applicantStart).join("\n")).toContain("принят");
			expect(urlValuesSince(fake, applicantStart)).toContain("tg://user?id=100");

			await runtime.shutdown();
			runtime = await createRuntime(databasePath, fake, clock, { adminTelegramIds: ["900"] });
			await runtime.bot.handleUpdate({ update_id: 9, message: privateMessageForUser(9, 300, "/my_applications") });
			expect(String(fake.lastMessage()?.text)).toContain("принят");
			expect(await runtime.boundary.query("SELECT status, hidden_from_status FROM collaborations WHERE id = ?", [FIRST_ID])).toEqual([{ status: "hidden", hidden_from_status: "published" }]);
			await runtime.bot.handleUpdate({ update_id: 10, message: privateMessageForUser(10, 400, `/start c_${FIRST_TOKEN}`) });
			expect(String(fake.lastMessage()?.text)).toContain("Предложение недоступно");
			await runtime.bot.handleUpdate({ update_id: 11, callback_query: callbackForUser(11, 400, staleApply) });
			expect(String(fake.lastMessage()?.text)).toContain("Предложение недоступно");
			const feedAfterRestartStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 12, message: privateMessageForUser(12, 400, "/feed") });
			expect(messagesSince(fake, feedAfterRestartStart).join("\n")).not.toContain("First browse card");
			const authorAfterRestartStart = fake.calls.length;
			await runtime.bot.handleUpdate({ update_id: 13, message: privateMessageForUser(13, 100, "/my_collaborations") });
			expect(messagesSince(fake, authorAfterRestartStart).join("\n")).toContain("скрыта");
		} finally {
			await runtime?.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

async function createRuntime(
	databasePath: string,
	fake: FakeTelegramApi,
	clock: FakeClock,
	options: { readonly adminTelegramIds?: readonly string[] } = {},
): Promise<BotRuntime> {
	const { runtime } = await createFakeBotRuntime({
		databasePath,
		fake,
		clock,
		adminTelegramIds: options.adminTelegramIds ?? [],
	});
	return runtime;
}

async function createSeededFixture(prefix: string) {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	const databasePath = join(directory, "app.sqlite");
	const clock = new FakeClock(NOW);
	const fake = createFakeTelegramApi();
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

async function insertApplication(boundary: DatabaseBoundary, options: {
	readonly id: string;
	readonly collaborationId?: string;
	readonly applicantProfileId: string;
	readonly message: string;
	readonly status?: "pending" | "accepted" | "rejected" | "closed";
	readonly decidedByProfileId?: string;
	readonly decidedAt?: number;
	readonly createdAt?: number;
}): Promise<void> {
	await boundary.execute(
		`INSERT INTO applications (
			id, collaboration_id, applicant_profile_id, message, terms_version,
			collaboration_version, status, decided_by_profile_id, decided_at, created_at
		) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
		[
			options.id,
			options.collaborationId ?? FIRST_ID,
			options.applicantProfileId,
			options.message,
			options.status ?? "pending",
			options.decidedByProfileId ?? null,
			options.decidedAt ?? null,
			options.createdAt ?? NOW,
		],
	);
}

async function applicationStatus(boundary: DatabaseBoundary, applicationId: string): Promise<string | undefined> {
	const [row] = await boundary.query<{ status: string }>("SELECT status FROM applications WHERE id = ?", [applicationId]);
	return row?.status;
}

async function profileSessionState(boundary: DatabaseBoundary, userId: string): Promise<Record<string, unknown> | undefined> {
	const [row] = await boundary.query<{ state_json: string }>("SELECT state_json FROM profile_sessions WHERE telegram_user_id = ?", [userId]);
	return row === undefined ? undefined : JSON.parse(row.state_json) as Record<string, unknown>;
}

async function startQuickProfile(
	runtime: BotRuntime,
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
	runtime: BotRuntime,
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

async function submitQuickApplication(
	runtime: BotRuntime,
	fake: FakeTelegramApi,
	input: {
		readonly userId: number;
		readonly username: string;
		readonly firstUpdateId: number;
		readonly publicToken: string;
		readonly displayName: string;
		readonly platformUrl: string;
		readonly message: string;
	},
): Promise<void> {
	await runtime.bot.handleUpdate({ update_id: input.firstUpdateId, message: privateMessageForUser(input.firstUpdateId, input.userId, `/start c_${input.publicToken}`, input.username) });
	await runtime.bot.handleUpdate({ update_id: input.firstUpdateId + 1, callback_query: callbackForUser(input.firstUpdateId + 1, input.userId, callbackData(fake, `application:start:d:${input.publicToken}`), input.username) });
	await runtime.bot.handleUpdate({ update_id: input.firstUpdateId + 2, callback_query: callbackForUser(input.firstUpdateId + 2, input.userId, callbackData(fake, "profile:type:blogger"), input.username) });
	await runtime.bot.handleUpdate({ update_id: input.firstUpdateId + 3, message: privateMessageForUser(input.firstUpdateId + 3, input.userId, input.displayName, input.username) });
	await runtime.bot.handleUpdate({ update_id: input.firstUpdateId + 4, callback_query: callbackForUser(input.firstUpdateId + 4, input.userId, callbackData(fake, "profile:platform:other"), input.username) });
	await runtime.bot.handleUpdate({ update_id: input.firstUpdateId + 5, message: privateMessageForUser(input.firstUpdateId + 5, input.userId, input.platformUrl, input.username) });
	await runtime.bot.handleUpdate({ update_id: input.firstUpdateId + 6, message: privateMessageForUser(input.firstUpdateId + 6, input.userId, input.message, input.username) });
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting for fake runtime state");
}

async function seedCards(boundary: DatabaseBoundary): Promise<void> {
	for (const [userId, profileId] of [["100", "10000000-0000-4000-8000-000000000001"], ["101", "10100000-0000-4000-8000-000000000001"]] as const) {
		await boundary.execute("INSERT INTO telegram_users (telegram_user_id, username, display_name, status, blocked_at, created_at, updated_at) VALUES (?, NULL, ?, 'active', NULL, ?, ?)", [userId, `Author ${userId}`, NOW, NOW]);
		await boundary.execute("INSERT INTO profiles (id, telegram_user_id, type, display_name, city_code, status, created_at, updated_at, description) VALUES (?, ?, 'blogger', ?, 'ekaterinburg', 'active', ?, ?, NULL)", [profileId, userId, `Author ${userId}`, NOW, NOW]);
		await boundary.execute("INSERT INTO profile_platforms (id, profile_id, platform_type, url, title, username, telegram_chat_id, audience_size) VALUES (?, ?, 'website', ?, NULL, NULL, NULL, NULL)", [`${profileId.slice(0, 8)}-0000-4000-8000-000000000002`, profileId, `https://example.com/${userId}`]);
	}
	await insertCard(boundary, FIRST_ID, FIRST_TOKEN, "10000000-0000-4000-8000-000000000001", "First browse card", "blogger", "published", NOW - 100);
	await insertCard(boundary, SECOND_ID, SECOND_TOKEN, "10100000-0000-4000-8000-000000000001", "Second browse card", "any", "published", NOW - 200);
	await insertCard(boundary, "dddddddd-0000-4000-8000-000000000003", HIDDEN_TOKEN, "10000000-0000-4000-8000-000000000001", "Hidden browse card", "blogger", "hidden", NOW - 50);
}

async function insertCard(boundary: DatabaseBoundary, id: string, token: string, profileId: string, title: string, target: string, status: string, publishedAt: number): Promise<void> {
	await boundary.execute(
		"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at, published_at, hidden_from_status, hidden_at) VALUES (?, ?, ?, 'barter', ?, ?, 'Useful collaboration offer', 'Reliable partner expected', 2, ?, NULL, 'ekaterinburg', ?, 1, 0, ?, ?, ?, ?, ?)",
		[id, token, profileId, target, title, NOW + 86_400_000, status, NOW - 1000, status === "hidden" ? NOW - 50 : NOW - 1000, publishedAt, status === "hidden" ? "published" : null, status === "hidden" ? NOW - 50 : null],
	);
	await boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, 'city')", [id]);
	if (status === "published") {
		await boundary.execute(
			"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, '-1001', ?, 'published', 1, 0, ?, 1, NULL, NULL, ?)",
			[id, id === FIRST_ID ? 41 : 42, "a".repeat(64), publishedAt],
		);
	}
}

function privateMessage(messageId: number, text: string) { return privateMessageForUser(messageId, 200, text); }
function callback(id: number, data: string) { return callbackForUser(id, 200, data); }

function callbackDataForButtonSince(fake: FakeTelegramApi, label: string, fromCall: number): string {
	for (const call of fake.calls.slice(fromCall).reverse()) {
		if (call.method !== "sendMessage") continue;
		for (const button of inlineButtons(call.payload.reply_markup)) {
			if (typeof button.text === "string" && button.text.includes(label) && typeof button.callback_data === "string") {
				return button.callback_data;
			}
		}
	}
	throw new Error(`callback button ${label} was not rendered`);
}

function messagesSince(fake: FakeTelegramApi, fromCall: number): string[] {
	return fake.calls.slice(fromCall).flatMap((call) => call.method === "sendMessage" && typeof call.payload.text === "string" ? [call.payload.text] : []);
}

function urlValuesSince(fake: FakeTelegramApi, fromCall: number): string[] {
	return fake.calls.slice(fromCall).flatMap((call) => call.method === "sendMessage"
		? inlineButtons(call.payload.reply_markup).flatMap((button) => typeof button.url === "string" ? [button.url] : [])
		: []);
}

function inlineButtons(value: unknown): readonly Record<string, unknown>[] {
	let parsed = value;
	if (typeof value === "string") {
		try { parsed = JSON.parse(value) as unknown; } catch { return []; }
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
	const keyboard = (parsed as { inline_keyboard?: unknown }).inline_keyboard;
	if (!Array.isArray(keyboard)) return [];
	return keyboard.flatMap((row) => Array.isArray(row)
		? row.filter((button): button is Record<string, unknown> => typeof button === "object" && button !== null && !Array.isArray(button))
		: []);
}
