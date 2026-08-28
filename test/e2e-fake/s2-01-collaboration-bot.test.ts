import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bot } from "grammy";
import { describe, expect, it } from "vitest";

import { DurableCommandExecutor } from "../../src/shared/application/commands/command-executor.js";
import { hashCanonicalInput } from "../../src/platform/crypto/canonical-input-hash.js";
import { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { SqliteDurableCommandStore } from "../../src/platform/database/durable-command-repository.js";
import { MigrationRunner, MigrationSource } from "../../src/platform/database/migrations.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/platform/database/transaction-runner.js";
import { SqliteTelegramUserRepository } from "../../src/platform/database/telegram-user-repository.js";
import { FakeClock } from "../support/fake-clock.js";
import type { FakeTelegramApi } from "../support/fake-telegram-api.js";
import { CollaborationDraftService } from "../../src/modules/collaborations/index.js";
import { SqliteCollaborationRepository } from "../../src/modules/collaborations/infrastructure/sqlite-collaboration-repository.js";
import { SqliteCollaborationSessionRepository } from "../../src/modules/collaborations/infrastructure/sqlite-collaboration-session-repository.js";
import { ProfileService } from "../../src/modules/profiles/index.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { SqliteProfileSessionRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-session-repository.js";
import { registerTelegramRouter } from "../../src/runtime/telegram/telegram-router.js";
import {
	callbackData,
	callbackForUser,
	createFakeTelegramApi,
	privateMessageForUser,
} from "../support/fake-telegram.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("S2-01 fake collaboration wizard", () => {
	it("does not let an old Cancel callback delete a replacement draft or coexist with profile editing", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-01-stale-cancel-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		const fake = createFakeTelegramApi();
		try {
			await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
			await seedProfile(boundary, clock);
			const bot = buildBot(boundary, clock, fake);
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/start") });
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, callbackData(fake, "collaboration:start")) });
			const oldCancel = callbackData(fake, "collaboration:cancel");
			await bot.handleUpdate({ update_id: 3, callback_query: callback(3, oldCancel) });
			await bot.handleUpdate({ update_id: 4, callback_query: callback(4, "collaboration:start") });
			const replacement = await boundary.query<{ id: string }>("SELECT id FROM collaborations WHERE status = 'draft'");
			expect(replacement).toHaveLength(1);
			await bot.handleUpdate({ update_id: 5, callback_query: callback(5, oldCancel) });
			expect(await boundary.query<{ id: string }>("SELECT id FROM collaborations WHERE status = 'draft'")).toEqual(replacement);
			await bot.handleUpdate({ update_id: 6, callback_query: callback(6, "profile:edit") });
			expect(await boundary.query("SELECT telegram_user_id FROM profile_sessions")).toEqual([]);
			await bot.handleUpdate({ update_id: 7, message: privateMessage(7, "/cancel") });
			expect(await boundary.query("SELECT id FROM collaborations")).toEqual([]);
			expect(await boundary.query("SELECT telegram_user_id FROM profile_sessions")).toEqual([]);
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});

	it("creates, resumes, previews and replay-safely cancels a draft", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-01-e2e-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		const fake = createFakeTelegramApi();
		let boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			await seedProfile(boundary, clock);
			const firstBot = buildBot(boundary, clock, fake);
			await firstBot.init();
			await firstBot.handleUpdate({ update_id: 1, message: privateMessage(1, "/start") });
			await firstBot.handleUpdate({ update_id: 2, callback_query: callback(2, callbackData(fake, "collaboration:start")) });
			const formatCallbacks = fake.lastMessage()?.reply_markup?.inline_keyboard?.flat().map((button) => (button as { callback_data?: unknown }).callback_data).filter((data): data is string => typeof data === "string") ?? [];
			expect(formatCallbacks.length).toBeGreaterThan(0);
			expect(formatCallbacks.every((data) => Buffer.byteLength(data, "utf8") <= 64)).toBe(true);
			await firstBot.handleUpdate({ update_id: 3, callback_query: callback(3, callbackData(fake, "collaboration:format:joint_content")) });
			await firstBot.handleUpdate({ update_id: 4, callback_query: callback(4, callbackData(fake, "collaboration:target:blogger")) });
			expect(String(fake.lastMessage()?.text)).toContain("могут отличаться от тем вашего профиля");
			expect(String(fake.lastMessage()?.text)).toContain("Еда и рестораны");
			await firstBot.handleUpdate({ update_id: 5, message: privateMessage(5, "Город") });
			await firstBot.handleUpdate({ update_id: 6, message: privateMessage(6, "<Городской проект>") });
			await firstBot.handleUpdate({ update_id: 7, message: privateMessage(7, "Снимем совместный материал для аудитории.") });
			await firstBot.handleUpdate({ update_id: 8, message: privateMessage(8, "подарок") });
			expect(String(fake.lastMessage()?.text)).toContain("Значение не подходит");
			expect(await boundary.query<{ step: string }>("SELECT step FROM collaboration_sessions WHERE telegram_user_id = '100'")).toEqual([{ step: "expectation" }]);
			await firstBot.handleUpdate({ update_id: 9, message: privateMessage(9, "Нужен партнёр для съёмки и согласования.") });
			await firstBot.handleUpdate({ update_id: 10, message: privateMessage(10, "2") });
			await firstBot.handleUpdate({ update_id: 11, message: privateMessage(11, "20.11.2023") });
			await firstBot.handleUpdate({ update_id: 12, message: privateMessage(12, "25.11.2023") });
			expect(String(fake.lastMessage()?.text)).toContain("&lt;Городской проект&gt;");
			expect(String(fake.lastMessage()?.text)).not.toContain("public_token");
			expect(await boundary.query<{ status: string }>("SELECT status FROM collaborations WHERE author_profile_id = (SELECT id FROM profiles WHERE telegram_user_id = '100')")).toEqual([{ status: "draft" }]);
			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			const restarted = buildBot(boundary, clock, fake);
			await restarted.init();
			await restarted.handleUpdate({ update_id: 13, message: privateMessage(13, "/start") });
			await restarted.handleUpdate({ update_id: 14, callback_query: callback(14, callbackData(fake, "collaboration:start")) });
			expect(String(fake.lastMessage()?.text)).toContain("&lt;Городской проект&gt;");
			await restarted.handleUpdate({ update_id: 15, message: privateMessage(15, "/cancel") });
			expect(await boundary.query("SELECT id FROM collaborations")).toEqual([]);
			expect(await boundary.query("SELECT telegram_user_id FROM collaboration_sessions")).toEqual([]);
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});

	it("defers to the profile wizard and resumes collaboration after profile completion", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-01-deferred-"));
		const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
		const clock = new FakeClock(new Date("2023-11-14T10:00:00.000Z"));
		const fake = createFakeTelegramApi();
		try {
			await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
			const bot = buildBot(boundary, clock, fake);
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/start") });
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, callbackData(fake, "collaboration:start")) });
			await bot.handleUpdate({ update_id: 3, callback_query: callback(3, callbackData(fake, "profile:type:blogger")) });
			await bot.handleUpdate({ update_id: 4, message: privateMessage(4, "Alice Creator") });
			await bot.handleUpdate({ update_id: 5, message: privateMessage(5, "Город") });
			await bot.handleUpdate({ update_id: 6, message: privateMessage(6, "Ищу партнёров для городских проектов.") });
			await bot.handleUpdate({ update_id: 7, callback_query: callback(7, callbackData(fake, "profile:platform:other")) });
			await bot.handleUpdate({ update_id: 8, message: privateMessage(8, "https://example.com/alice") });
			await bot.handleUpdate({ update_id: 9, message: privateMessage(9, "100") });
			await bot.handleUpdate({ update_id: 10, callback_query: callback(10, callbackData(fake, "profile:apply")) });
			expect(String(fake.lastMessage()?.text)).toContain("Выберите формат коллаборации");
			expect(await boundary.query("SELECT status FROM collaborations")).toEqual([{ status: "draft" }]);
			expect(await boundary.query("SELECT state_json FROM profile_sessions")).toEqual([]);
		} finally { await boundary.close(); await rm(directory, { recursive: true, force: true }); }
	});
});

function buildBot(boundary: DatabaseBoundary, clock: FakeClock, fake: FakeTelegramApi): Bot {
	const transactionRunner = new DatabaseBoundaryTransactionRunner(boundary);
	const profileSessions = new SqliteProfileSessionRepository(boundary);
	const service = new CollaborationDraftService(new SqliteCollaborationRepository(boundary), new SqliteCollaborationSessionRepository(boundary), transactionRunner, clock, profileSessions);
	const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
	registerTelegramRouter(bot, {
		profileService: new ProfileService(new SqliteProfileRepository(boundary), transactionRunner, clock),
		sessionRepository: profileSessions,
		telegramUserRepository: new SqliteTelegramUserRepository(boundary),
		durableCommandExecutor: new DurableCommandExecutor(transactionRunner, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock),
		clock,
		helpContact: "@helpdesk",
		collaborationDraftService: service,
	});
	return bot;
}

async function seedProfile(boundary: DatabaseBoundary, clock: FakeClock): Promise<void> {
	const now = clock.now().getTime();
	await new SqliteTelegramUserRepository(boundary).upsert({ telegramUserId: "100", username: "alice", displayName: "Alice", updatedAt: now });
	await new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock).create("100", { type: "blogger", displayName: "Alice", description: "A useful local profile.", topics: ["city"], platforms: [{ platformType: "website", url: "https://example.com/alice" }] });
}

function privateMessage(messageId: number, text: string) {
	return privateMessageForUser(messageId, 100, text, "alice", "Alice");
}

function callback(id: number, data: string) {
	return callbackForUser(id, 100, data, "alice", "Alice");
}
