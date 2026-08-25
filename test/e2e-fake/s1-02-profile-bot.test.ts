import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bot } from "grammy";
import type { UserFromGetMe, Update } from "grammy/types";
import { describe, expect, it } from "vitest";

import { ProfileService } from "../../src/application/profiles/profile-service.js";
import type { ProfileSessionRepository } from "../../src/application/ports/profile-session-repository.js";
import { DurableCommandExecutor } from "../../src/application/commands/command-executor.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { SqliteProfileRepository } from "../../src/infrastructure/database/profile-repository.js";
import { SqliteProfileSessionRepository } from "../../src/infrastructure/database/profile-session-repository.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { SqliteTelegramUserRepository } from "../../src/infrastructure/database/telegram-user-repository.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import { FakeTelegramApi } from "../../src/infrastructure/testing/fake-telegram-api.js";
import { registerProfileBot } from "../../src/bot/profile-bot.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("S1-02 fake Telegram profile journey", () => {
	it("resumes after restart, uses native channel picker, and applies exactly once", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-e2e-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		let failSessionDelete = false;
		const fake = new FakeTelegramApi({
			token: "fake-token",
			botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
		});
		let boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			const durableCommandExecutor = new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
			const firstProfileService = new ProfileService(
					new SqliteProfileRepository(boundary),
					new DatabaseBoundaryTransactionRunner(boundary),
					clock,
				);
			let profileServiceForAssertions = firstProfileService;
			registerProfileBot(bot, {
				profileService: firstProfileService,
				sessionRepository: sessionRepositoryWithFailure(new SqliteProfileSessionRepository(boundary), () => failSessionDelete),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor,
				clock,
				helpContact: "@helpdesk",
				requestIdFactory: () => 12345,
			});
			await bot.init();

			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/start") });
			const profileCallback = callbackData(fake, "profile:view");
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, profileCallback) });
			const createCallback = fake.lastMessage()?.reply_markup?.inline_keyboard?.flat().find((button) => (button as { callback_data?: string }).callback_data === "profile:create");
			expect(createCallback).toBeDefined();
			await bot.handleUpdate({ update_id: 3, callback_query: callback(3, "profile:create") });
			const initialTypeCallback = callbackData(fake, "profile:type:blogger");
			await bot.handleUpdate({ update_id: 4, message: privateMessage(4, "Блогер") });
			const currentCancelCallback = callbackData(fake, "profile:cancel");
			await bot.handleUpdate({ update_id: 5, callback_query: callback(5, initialTypeCallback) });
			await bot.handleUpdate({ update_id: 6, callback_query: callbackForUser(6, 101, currentCancelCallback) });
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ revision: 2, state: { step: "display_name" } });
			await bot.handleUpdate({ update_id: 7, message: privateMessage(7, "Alice Creator") });
			await bot.handleUpdate({ update_id: 8, message: privateMessage(8, "Город, Еда и рестораны") });
			await bot.handleUpdate({ update_id: 9, message: privateMessage(9, "Ищу партнёров для полезных городских проектов.") });
			await bot.handleUpdate({ update_id: 10, callback_query: callback(10, callbackData(fake, "profile:platform:telegram")) });
			const picker = fake.lastMessage()?.reply_markup?.keyboard?.flat().find((button) => "request_chat" in button);
			expect(picker).toMatchObject({ request_chat: { request_id: 12345, chat_is_channel: true, request_username: true, request_title: true } });
			expect(String(fake.lastMessage()?.text)).toContain("Указать другую ссылку");
			expect(fake.lastMessage()?.reply_markup?.keyboard?.flat().find((button) => (button as { text?: string }).text === "Указать другую ссылку")).toBeDefined();

			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const reopenedProfileService = new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock);
			profileServiceForAssertions = reopenedProfileService;
			const reopenedExecutor = new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
			let restartedBot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerProfileBot(restartedBot, {
				profileService: reopenedProfileService,
				sessionRepository: sessionRepositoryWithFailure(new SqliteProfileSessionRepository(boundary), () => failSessionDelete),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: reopenedExecutor,
				clock,
				helpContact: "@helpdesk",
				requestIdFactory: () => 12346,
			});
			await restartedBot.init();
			await restartedBot.handleUpdate({ update_id: 11, message: privateMessage(11, "/start") });
			const resumeCallback = callbackData(fake, "profile:resume");
			await restartedBot.handleUpdate({ update_id: 12, callback_query: callback(12, resumeCallback) });
			const resumedPlatformCallback = callbackData(fake, "profile:platform:telegram");
			await restartedBot.handleUpdate({ update_id: 13, callback_query: callback(13, resumedPlatformCallback) });
			await restartedBot.handleUpdate({
				update_id: 14,
				message: { ...privateMessage(14), chat_shared: { request_id: 12346, chat_id: -100123, title: "Alice Channel" } },
			});
			await restartedBot.handleUpdate({ update_id: 15, message: privateMessage(15, "https://t.me/alice_channel") });
			await restartedBot.handleUpdate({ update_id: 16, message: privateMessage(16, "-") });
			await restartedBot.handleUpdate({ update_id: 17, message: privateMessage(17, "@alice_contact") });
			const firstApplyCallback = callbackData(fake, "profile:apply");
			await restartedBot.handleUpdate({ update_id: 18, callback_query: callback(18, firstApplyCallback) });
			clock.advanceBy(60_000);
			await restartedBot.handleUpdate({ update_id: 18, callback_query: callback(18, firstApplyCallback) });

			expect(await profileServiceForAssertions.getOwn("100")).toMatchObject({ displayName: "Alice Creator", privateContact: "@alice_contact", platforms: [{ url: "https://t.me/alice_channel" }] });
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM profiles WHERE status = 'active'")).toEqual([{ count: 1 }]);
			expect(fake.calls.some((call) => call.method === "sendMessage" && String(call.payload.text).includes("Готово — профиль сохранён"))).toBe(true);

			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const postApplyProfileService = new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock);
			profileServiceForAssertions = postApplyProfileService;
			const postApplyExecutor = new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
			restartedBot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerProfileBot(restartedBot, {
				profileService: postApplyProfileService,
				sessionRepository: sessionRepositoryWithFailure(new SqliteProfileSessionRepository(boundary), () => failSessionDelete),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: postApplyExecutor,
				clock,
				helpContact: "@helpdesk",
				requestIdFactory: () => 12347,
			});
			await restartedBot.init();
			await restartedBot.handleUpdate({ update_id: 19, message: privateMessage(19, "/profile") });
			expect(String(fake.lastMessage()?.text)).toContain("Alice Creator");
			expect(String(fake.lastMessage()?.text)).toContain("Кто вы: Блогер");
			expect(String(fake.lastMessage()?.text)).toContain("Темы: Город, Еда и рестораны");
			expect(String(fake.lastMessage()?.text)).toContain("https://t.me/alice_channel");
			const mainMenuCallback = fake.lastMessage()?.reply_markup?.inline_keyboard?.flat().find((button) => (button as { callback_data?: string }).callback_data === "menu:home");
			expect(mainMenuCallback).toBeDefined();
			await restartedBot.handleUpdate({ update_id: 20, callback_query: callback(20, "menu:home") });
			expect(String(fake.lastMessage()?.text)).toContain("Давай вместе");

			await restartedBot.handleUpdate({ update_id: 21, callback_query: callback(21, "profile:edit") });
			await restartedBot.handleUpdate({ update_id: 22, message: privateMessage(22, "/cancel") });
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toBeUndefined();
			await restartedBot.handleUpdate({ update_id: 23, callback_query: callback(23, "profile:edit") });
			await restartedBot.handleUpdate({ update_id: 24, message: privateMessage(24, "Блогер") });
			await restartedBot.handleUpdate({ update_id: 25, message: privateMessage(25, "Alice Studio") });
			await restartedBot.handleUpdate({ update_id: 26, message: privateMessage(26, "Город") });
			await restartedBot.handleUpdate({ update_id: 27, message: privateMessage(27, "Ищу партнёров для обновлённого городского проекта.") });
			await restartedBot.handleUpdate({ update_id: 28, callback_query: callback(28, callbackData(fake, "profile:platform:website")) });
			await restartedBot.handleUpdate({ update_id: 29, message: privateMessage(29, "https://example.com/alice") });
			await restartedBot.handleUpdate({ update_id: 30, message: privateMessage(30, "100") });
			await restartedBot.handleUpdate({ update_id: 31, message: privateMessage(31, "@new_contact") });
			const secondApplyCallback = callbackData(fake, "profile:apply");
			failSessionDelete = true;
			await expect(restartedBot.handleUpdate({ update_id: 32, callback_query: callback(32, secondApplyCallback) })).rejects.toThrow("session cleanup failed");
			expect(await profileServiceForAssertions.getOwn("100")).toMatchObject({ displayName: "Alice Creator" });
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "review" } });
			failSessionDelete = false;
			await restartedBot.handleUpdate({ update_id: 32, callback_query: callback(32, secondApplyCallback) });
			expect(await profileServiceForAssertions.getOwn("100")).toMatchObject({ displayName: "Alice Studio", privateContact: "@new_contact", platforms: [{ url: "https://example.com/alice" }] });
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM profiles WHERE status = 'active'")).toEqual([{ count: 1 }]);
			const callsBeforeGroupUpdate = fake.calls.length;
			await restartedBot.handleUpdate({ update_id: 33, message: { ...privateMessage(33, "/start"), chat: { id: -100, type: "group", title: "Group" } } });
			expect(fake.calls.length).toBe(callsBeforeGroupUpdate);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("accepts a direct public Telegram URL after channel selection", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-direct-url-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const fake = new FakeTelegramApi({
			token: "fake-token",
			botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
		});
		const boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			const profileService = new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock);
			registerProfileBot(bot, {
				profileService,
				sessionRepository: new SqliteProfileSessionRepository(boundary),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock),
				clock,
				helpContact: "@helpdesk",
				requestIdFactory: () => 12348,
			});
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/profile") });
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, "profile:create") });
			await bot.handleUpdate({ update_id: 3, message: privateMessage(3, "Блогер") });
			await bot.handleUpdate({ update_id: 4, message: privateMessage(4, "Direct Creator") });
			await bot.handleUpdate({ update_id: 5, message: privateMessage(5, "Город") });
			await bot.handleUpdate({ update_id: 6, message: privateMessage(6, "Ищу партнёров для прямой ссылки.") });
			await bot.handleUpdate({ update_id: 7, callback_query: callback(7, callbackData(fake, "profile:platform:telegram")) });
			await bot.handleUpdate({ update_id: 8, message: privateMessage(8, "https://t.me/direct_channel") });
			expect(String(fake.lastMessage()?.text)).toContain("Укажите размер аудитории");
			expect(String(fake.lastMessage()?.text)).not.toContain("предложенную площадку");
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "audience", draft: { platform: { url: "https://t.me/direct_channel", username: "direct_channel" } } } });
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

function privateMessage(messageId: number, text?: string): NonNullable<Update["message"]> {
	return { message_id: messageId, date: 1_700_000_000, chat: { id: 100, type: "private" }, from: { id: 100, is_bot: false, first_name: "Alice", username: "alice" }, ...(text === undefined ? {} : { text }) } as NonNullable<Update["message"]>;
}

function callback(id: number, data: string): NonNullable<Update["callback_query"]> {
	return callbackForUser(id, 100, data);
}

function callbackForUser(id: number, userId: number, data: string): NonNullable<Update["callback_query"]> {
	return { id: `callback-${id}`, from: { id: userId, is_bot: false, first_name: "Alice", username: "alice" }, message: { ...privateMessage(id), chat: { id: userId, type: "private" } }, chat_instance: "instance", data } as NonNullable<Update["callback_query"]>;
}

function callbackData(fake: FakeTelegramApi, prefix: string): string {
	const button = fake.lastMessage()?.reply_markup?.inline_keyboard?.flat().find((candidate) => String((candidate as { callback_data?: unknown }).callback_data).startsWith(prefix));
	const data = (button as { callback_data?: unknown } | undefined)?.callback_data;
	if (typeof data !== "string") throw new Error(`callback ${prefix} was not rendered`);
	return data;
}

function sessionRepositoryWithFailure(repository: ProfileSessionRepository, shouldFail: () => boolean): ProfileSessionRepository {
	return {
		findActive: (...args) => repository.findActive(...args),
		save: (...args) => repository.save(...args),
		delete: async (telegramUserId) => {
			if (shouldFail()) throw new Error("session cleanup failed");
			await repository.delete(telegramUserId);
		},
	};
}
