import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bot } from "grammy";
import { describe, expect, it } from "vitest";

import { DurableCommandExecutor } from "../../src/shared/application/commands/command-executor.js";
import { hashCanonicalInput } from "../../src/platform/crypto/canonical-input-hash.js";
import { SqliteDurableCommandStore } from "../../src/infrastructure/database/durable-command-repository.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { SqliteTelegramUserRepository } from "../../src/infrastructure/database/telegram-user-repository.js";
import { FakeClock } from "../support/fake-clock.js";
import { SystemProviderDeadline } from "../../src/platform/time/provider-deadline.js";
import {
	ProfileAudienceService,
	ProfileService,
	type ProfileSessionRepository,
	type TelegramAudienceTarget,
} from "../../src/modules/profiles/index.js";
import { SqliteProfileRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-repository.js";
import { SqliteProfileSessionRepository } from "../../src/modules/profiles/infrastructure/sqlite-profile-session-repository.js";
import { registerTelegramRouter } from "../../src/presentation/telegram/telegram-router.js";
import {
	callbackData,
	callbackForUser,
	createFakeTelegramApi,
	privateMessageForUser,
} from "../support/fake-telegram.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("S1-02 fake Telegram profile journey", () => {
	it("resumes after restart, uses native channel picker, and applies exactly once", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-e2e-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		let failSessionDelete = false;
		const audienceTargets: TelegramAudienceTarget[] = [];
		let resolveAudience: ((value: number) => void) | undefined;
		let lookupStartedResolve: (() => void) | undefined;
		const lookupStarted = new Promise<void>((resolve) => { lookupStartedResolve = resolve; });
		const fake = createFakeTelegramApi();
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
			registerTelegramRouter(bot, {
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
			await bot.handleUpdate({
				update_id: 6,
				callback_query: callbackForUser(6, 101, currentCancelCallback, "alice", "Alice"),
			});
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
			const reopenedRepository = new SqliteProfileRepository(boundary);
			const reopenedTransactions = new DatabaseBoundaryTransactionRunner(boundary);
			const reopenedProfileService = new ProfileService(reopenedRepository, reopenedTransactions, clock);
			const profileAudienceService = new ProfileAudienceService(
				{
					getChatMemberCount: (target) => {
						audienceTargets.push(target);
						lookupStartedResolve?.();
						return new Promise<number>((resolve) => { resolveAudience = resolve; });
					},
				},
				reopenedRepository,
				reopenedTransactions,
				clock,
				new SystemProviderDeadline(),
			);
			profileServiceForAssertions = reopenedProfileService;
			const reopenedExecutor = new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
			let restartedBot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerTelegramRouter(restartedBot, {
				profileService: reopenedProfileService,
				sessionRepository: sessionRepositoryWithFailure(new SqliteProfileSessionRepository(boundary), () => failSessionDelete),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: reopenedExecutor,
				clock,
				profileAudienceService,
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
				message: { ...privateMessage(14), chat_shared: { request_id: 12346, chat_id: -100123, title: "Alice Channel", username: "alice_channel" } },
			});
			await restartedBot.handleUpdate({ update_id: 15, message: privateMessage(15, "-") });
			const firstApplyCallback = callbackData(fake, "profile:apply");
			const callsBeforeApply = fake.calls.length;
			const applyPromise = restartedBot.handleUpdate({ update_id: 17, callback_query: callback(17, firstApplyCallback) });
			await lookupStarted;
			expect(fake.calls.at(-1)?.method).toBe("answerCallbackQuery");
			expect(fake.calls.slice(callsBeforeApply).filter((call) => call.method === "sendMessage")).toHaveLength(0);
			const observer = new DatabaseBoundary(databasePath);
			try {
				expect(await observer.query("SELECT status FROM command_receipts WHERE command_id = 'telegram:update:17'")).toEqual([{ status: "completed" }]);
				expect(await observer.query("SELECT audience_size FROM profile_platforms")).toEqual([{ audience_size: null }]);
				expect(await observer.query("SELECT telegram_user_id FROM profile_sessions WHERE telegram_user_id = '100'")).toEqual([]);
			} finally {
				await observer.close();
			}
			resolveAudience?.(321);
			await applyPromise;
			const applyReplies = fake.calls.slice(callsBeforeApply).filter((call) => call.method === "sendMessage");
			expect(applyReplies).toHaveLength(1);
			expect(String(applyReplies[0]?.payload.text)).toContain("Готово — профиль сохранён.");
			expect(String(applyReplies[0]?.payload.text)).toContain("Аудитория Telegram: 321 — снимок на момент сохранения.");
			clock.advanceBy(60_000);
			await restartedBot.handleUpdate({ update_id: 17, callback_query: callback(17, firstApplyCallback) });

			expect(audienceTargets).toEqual([{ kind: "chat_id", value: "-100123" }]);
			expect(await profileServiceForAssertions.getOwn("100")).toMatchObject({ displayName: "Alice Creator", platforms: [{ url: "https://t.me/alice_channel", audienceSize: 321 }] });
			expect(await boundary.query("SELECT audience_source, audience_observed_at FROM profile_platforms")).toEqual([{ audience_source: "telegram_api", audience_observed_at: 1_700_000_000_000 }]);
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM profiles WHERE status = 'active'")).toEqual([{ count: 1 }]);
			expect(fake.calls.some((call) => call.method === "sendMessage" && String(call.payload.text).includes("Готово — профиль сохранён"))).toBe(true);

			await boundary.close();
			boundary = new DatabaseBoundary(databasePath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const postApplyRepository = new SqliteProfileRepository(boundary);
			const postApplyTransactions = new DatabaseBoundaryTransactionRunner(boundary);
			const postApplyProfileService = new ProfileService(postApplyRepository, postApplyTransactions, clock);
			const nonTelegramTargets: TelegramAudienceTarget[] = [];
			profileServiceForAssertions = postApplyProfileService;
			const postApplyExecutor = new DurableCommandExecutor(postApplyTransactions, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock);
			restartedBot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerTelegramRouter(restartedBot, {
				profileService: postApplyProfileService,
				profileAudienceService: new ProfileAudienceService(
					{
						getChatMemberCount: async (target) => {
							nonTelegramTargets.push(target);
							return 1;
						},
					},
					postApplyRepository,
					postApplyTransactions,
					clock,
					new SystemProviderDeadline(),
				),
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
			expect(String(fake.lastMessage()?.text)).toContain("Описание: Ищу партнёров");
			expect(String(fake.lastMessage()?.text)).toContain("Аудитория: 321");
			expect(String(fake.lastMessage()?.text)).toContain("https://t.me/alice_channel");
			expect(String(fake.lastMessage()?.text)).not.toContain("Контакт для связи");
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
			expect(fake.lastMessage()?.reply_markup?.inline_keyboard?.flat()).toContainEqual(expect.objectContaining({ text: "Очистить" }));
			await restartedBot.handleUpdate({ update_id: 26, message: privateMessage(26, "-") });
			expect(String(fake.lastMessage()?.text)).toContain("Опишите профиль");
			expect(fake.lastMessage()?.reply_markup?.inline_keyboard?.flat()).toContainEqual(expect.objectContaining({ text: "Очистить" }));
			await restartedBot.handleUpdate({ update_id: 27, message: privateMessage(27, "-") });
			await restartedBot.handleUpdate({ update_id: 28, callback_query: callback(28, callbackData(fake, "profile:platform:other")) });
			await restartedBot.handleUpdate({ update_id: 29, message: privateMessage(29, "https://example.com/alice") });
			await restartedBot.handleUpdate({ update_id: 30, message: privateMessage(30, "-") });
			const secondApplyCallback = callbackData(fake, "profile:apply");
			failSessionDelete = true;
			await expect(restartedBot.handleUpdate({ update_id: 31, callback_query: callback(31, secondApplyCallback) })).rejects.toThrow("session cleanup failed");
			expect(await profileServiceForAssertions.getOwn("100")).toMatchObject({ displayName: "Alice Creator" });
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "review" } });
			failSessionDelete = false;
			await restartedBot.handleUpdate({ update_id: 31, callback_query: callback(31, secondApplyCallback) });
			expect(nonTelegramTargets).toEqual([]);
			expect(await profileServiceForAssertions.getOwn("100")).toMatchObject({ displayName: "Alice Studio", description: null, topics: [], platforms: [{ url: "https://example.com/alice" }] });
			expect((await profileServiceForAssertions.getOwn("100"))?.platforms[0]).not.toHaveProperty("audienceSize");
			await restartedBot.handleUpdate({ update_id: 32, message: privateMessage(32, "/profile") });
			expect(String(fake.lastMessage()?.text)).not.toContain("Темы:");
			expect(String(fake.lastMessage()?.text)).not.toContain("Описание:");
			expect(await boundary.query<{ count: number }>("SELECT count(*) AS count FROM profiles WHERE status = 'active'")).toEqual([{ count: 1 }]);
			const callsBeforeGroupUpdate = fake.calls.length;
			await restartedBot.handleUpdate({ update_id: 33, message: { ...privateMessage(33, "/start"), chat: { id: -100, type: "group", title: "Group" } } });
			expect(fake.calls.length).toBe(callsBeforeGroupUpdate);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("creates a minimal profile with skip buttons and accepts a direct public Telegram URL", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-direct-url-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const fake = createFakeTelegramApi();
		const boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			const repository = new SqliteProfileRepository(boundary);
			const transactions = new DatabaseBoundaryTransactionRunner(boundary);
			const profileService = new ProfileService(repository, transactions, clock);
			const audienceTargets: TelegramAudienceTarget[] = [];
			registerTelegramRouter(bot, {
				profileService,
				profileAudienceService: new ProfileAudienceService(
					{
						getChatMemberCount: async (target) => {
							audienceTargets.push(target);
							throw new Error("provider unavailable");
						},
					},
					repository,
					transactions,
					clock,
					new SystemProviderDeadline(),
				),
				sessionRepository: new SqliteProfileSessionRepository(boundary),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: new DurableCommandExecutor(transactions, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock),
				clock,
				helpContact: "@helpdesk",
				requestIdFactory: () => 12348,
			});
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/profile") });
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, "profile:create") });
			await bot.handleUpdate({ update_id: 3, message: privateMessage(3, "Блогер") });
			await bot.handleUpdate({ update_id: 4, message: privateMessage(4, "Direct Creator") });
			expect(fake.lastMessage()?.reply_markup?.inline_keyboard?.flat()).toContainEqual(expect.objectContaining({ text: "Пропустить" }));
			const topicsSkipCallback = callbackData(fake, "profile:omit");
			await bot.handleUpdate({ update_id: 5, callback_query: callback(5, topicsSkipCallback) });
			expect(String(fake.lastMessage()?.text)).toContain("Опишите профиль");
			const descriptionSkipCallback = callbackData(fake, "profile:omit");
			await bot.handleUpdate({ update_id: 6, callback_query: callback(6, topicsSkipCallback) });
			expect(String(fake.lastMessage()?.text)).toContain("неактуальна");
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "description", draft: { topics: [] } } });
			await bot.handleUpdate({ update_id: 7, callback_query: callback(7, descriptionSkipCallback) });
			await bot.handleUpdate({ update_id: 8, callback_query: callback(8, callbackData(fake, "profile:platform:telegram")) });
			await bot.handleUpdate({ update_id: 9, message: privateMessage(9, "https://t.me/direct_channel") });
			expect(String(fake.lastMessage()?.text)).toContain("Укажите размер аудитории");
			expect(String(fake.lastMessage()?.text)).not.toContain("предложенную площадку");
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "audience", draft: { platform: { url: "https://t.me/direct_channel", username: "direct_channel" } } } });
			await bot.handleUpdate({ update_id: 10, callback_query: callback(10, callbackData(fake, "profile:omit")) });
			expect(String(fake.lastMessage()?.text)).not.toContain("Описание:");
			expect(String(fake.lastMessage()?.text)).not.toContain("Темы:");
			expect(String(fake.lastMessage()?.text)).not.toContain("Аудитория:");
			await bot.handleUpdate({ update_id: 11, callback_query: callback(11, callbackData(fake, "profile:apply")) });
			expect(await profileService.getOwn("100")).toMatchObject({ description: null, topics: [], platforms: [{ url: "https://t.me/direct_channel" }] });
			expect(audienceTargets).toEqual([{ kind: "username", value: "@direct_channel" }]);
			expect(String(fake.lastMessage()?.text)).toBe("Готово — профиль сохранён.\n\nАудиторию Telegram определить не удалось; профиль сохранён, число можно указать позже в «Мой профиль».");
			expect(await boundary.query("SELECT status FROM command_receipts WHERE command_id = 'telegram:update:11'")).toEqual([{ status: "completed" }]);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("suppresses autofill for an explicit clear and allows a later empty save to retry", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-fut-01-clear-retry-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const fake = createFakeTelegramApi();
		const audienceTargets: TelegramAudienceTarget[] = [];
		const boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const repository = new SqliteProfileRepository(boundary);
			const transactions = new DatabaseBoundaryTransactionRunner(boundary);
			const profileService = new ProfileService(repository, transactions, clock);
			const sessions = new SqliteProfileSessionRepository(boundary);
			const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerTelegramRouter(bot, {
				profileService,
				profileAudienceService: new ProfileAudienceService(
					{
						getChatMemberCount: async (target) => {
							audienceTargets.push(target);
							return 654;
						},
					},
					repository,
					transactions,
					clock,
					new SystemProviderDeadline(),
				),
				sessionRepository: sessions,
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: new DurableCommandExecutor(transactions, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock),
				clock,
				helpContact: "@helpdesk",
			});
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/start") });
			await sessions.save({
				telegramUserId: "100",
				state: {
					version: 1,
					generation: "cccccccccccccccc",
					step: "audience",
					draft: {
						type: "blogger", displayName: "Alice Creator", description: null, topics: [],
						platform: { platformType: "telegram", url: "https://t.me/alice_channel", username: "alice_channel" },
						audienceAutofill: "allow",
					},
				},
				revision: 1,
				expiresAt: 1_700_000_100_000,
				updatedAt: 1_700_000_000_000,
			});
			await bot.handleUpdate({ update_id: 2, message: privateMessage(2, "50") });
			expect(await sessions.findActive("100", clock.now().getTime())).toMatchObject({
				state: { step: "review", draft: { audienceAutofill: "suppress", platform: { audienceSize: 50 } } },
			});
			await bot.handleUpdate({ update_id: 3, callback_query: callback(3, callbackData(fake, "profile:apply")) });
			expect(audienceTargets).toEqual([]);
			expect(await boundary.query("SELECT audience_size, audience_source, audience_observed_at FROM profile_platforms")).toEqual([{
				audience_size: 50, audience_source: "manual", audience_observed_at: 1_700_000_000_000,
			}]);
			const original = await profileService.getOwn("100");
			if (original === undefined) throw new Error("manual profile was not persisted");
			const populatedPlatform = original.platforms[0];
			if (populatedPlatform === undefined) throw new Error("profile platform was not persisted");

			await sessions.save({
				telegramUserId: "100",
				state: {
					version: 1,
					generation: "aaaaaaaaaaaaaaaa",
					step: "audience",
					draft: {
						type: "blogger", displayName: "Alice Creator", description: null, topics: [],
						platform: populatedPlatform,
						audienceAutofill: "allow",
					},
				},
				revision: 1,
				expiresAt: 1_700_000_100_000,
				updatedAt: 1_700_000_000_000,
			});
			await bot.handleUpdate({ update_id: 4, callback_query: callback(4, "profile:omit:gaaaaaaaaaaaaaaaa:r1") });
			const suppressed = await sessions.findActive("100", clock.now().getTime());
			expect(suppressed).toMatchObject({ state: { step: "review", draft: { audienceAutofill: "suppress" } } });
			expect(suppressed?.state.draft.platform).not.toHaveProperty("audienceSize");
			await bot.handleUpdate({ update_id: 5, callback_query: callback(5, callbackData(fake, "profile:apply")) });
			expect(audienceTargets).toEqual([]);
			expect((await profileService.getOwn("100"))?.platforms[0]).not.toHaveProperty("audienceSize");

			const emptyPlatform = (await profileService.getOwn("100"))?.platforms[0];
			if (emptyPlatform === undefined) throw new Error("empty platform was not persisted");
			await sessions.save({
				telegramUserId: "100",
				state: {
					version: 1,
					generation: "bbbbbbbbbbbbbbbb",
					step: "audience",
					draft: {
						type: "blogger", displayName: "Alice Creator", description: null, topics: [],
						platform: emptyPlatform,
					},
				},
				revision: 1,
				expiresAt: 1_700_000_100_000,
				updatedAt: 1_700_000_000_000,
			});
			await bot.handleUpdate({ update_id: 6, callback_query: callback(6, "profile:omit:gbbbbbbbbbbbbbbbb:r1") });
			expect(await sessions.findActive("100", clock.now().getTime())).toMatchObject({
				state: { step: "review", draft: { audienceAutofill: "allow" } },
			});
			await bot.handleUpdate({ update_id: 7, callback_query: callback(7, callbackData(fake, "profile:apply")) });
			expect(audienceTargets).toEqual([{ kind: "username", value: "@alice_channel" }]);
			expect(await profileService.getOwn("100")).toMatchObject({ platforms: [{ audienceSize: 654 }] });
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("enriches a quick profile and continues directly to the application message", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-fut-01-quick-profile-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const fake = createFakeTelegramApi();
		const targets: TelegramAudienceTarget[] = [];
		const boundary = new DatabaseBoundary(databasePath);
		try {
			await new MigrationRunner(await MigrationSource.fromDirectory(migrationsPath), clock).migrate(boundary);
			const repository = new SqliteProfileRepository(boundary);
			const transactions = new DatabaseBoundaryTransactionRunner(boundary);
			const sessions = new SqliteProfileSessionRepository(boundary);
			const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerTelegramRouter(bot, {
				profileService: new ProfileService(repository, transactions, clock),
				profileAudienceService: new ProfileAudienceService(
					{
						getChatMemberCount: async (target) => {
							targets.push(target);
							return 456;
						},
					},
					repository,
					transactions,
					clock,
					new SystemProviderDeadline(),
				),
				sessionRepository: sessions,
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: new DurableCommandExecutor(transactions, new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock),
				clock,
				helpContact: "@helpdesk",
				applicationService: { checkEligibility: async () => ({ ok: true }) } as never,
			});
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/start") });
			await sessions.save({
				telegramUserId: "100",
				state: {
					version: 1,
					generation: "dddddddddddddddd",
					step: "platform",
					draft: {
						type: "blogger", displayName: "Quick Creator", description: null, topics: [],
						audienceAutofill: "allow",
					},
					continuation: {
						kind: "submit_application",
						collaborationId: "11111111-1111-4111-8111-111111111111",
						source: "deep_link",
					},
				},
				revision: 1,
				expiresAt: 1_700_000_100_000,
				updatedAt: 1_700_000_000_000,
			});
			const quickCallback = "profile:platform:self:gdddddddddddddddd:r1";
			const callsBeforeSave = fake.calls.length;
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, quickCallback) });

			expect(targets).toEqual([{ kind: "username", value: "@alice" }]);
			expect(await sessions.findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "application_message" } });
			expect(await boundary.query("SELECT audience_size, audience_source, audience_observed_at FROM profile_platforms")).toEqual([{
				audience_size: 456, audience_source: "telegram_api", audience_observed_at: 1_700_000_000_000,
			}]);
			const replies = fake.calls.slice(callsBeforeSave).filter((call) => call.method === "sendMessage").map((call) => String(call.payload.text));
			expect(replies[0]).toBe("Профиль сохранён. Теперь добавьте сообщение автору коллаборации.\n\nАудитория Telegram: 456 — снимок на момент сохранения.");
			expect(replies.at(-1)?.toLowerCase()).toContain("сообщен");

			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, quickCallback) });
			expect(targets).toHaveLength(1);
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("routes the reply-button generic link flow to platformType other", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-generic-url-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const fake = createFakeTelegramApi();
		const boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerTelegramRouter(bot, {
				profileService: new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock),
				sessionRepository: new SqliteProfileSessionRepository(boundary),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock),
				clock,
				helpContact: "@helpdesk",
				requestIdFactory: () => 12349,
			});
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/profile") });
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, "profile:create") });
			await bot.handleUpdate({ update_id: 3, message: privateMessage(3, "Блогер") });
			await bot.handleUpdate({ update_id: 4, message: privateMessage(4, "Other Creator") });
			await bot.handleUpdate({ update_id: 5, message: privateMessage(5, "Город") });
			await bot.handleUpdate({ update_id: 6, message: privateMessage(6, "Ищу партнёров для универсальной ссылки.") });
			await bot.handleUpdate({ update_id: 7, callback_query: callback(7, callbackData(fake, "profile:platform:telegram")) });
			expect(fake.lastMessage()?.reply_markup?.keyboard?.flat().find((button) => (button as { text?: string }).text === "Указать другую ссылку")).toBeDefined();
			await bot.handleUpdate({ update_id: 8, message: privateMessage(8, "Указать другую ссылку") });
			await bot.handleUpdate({ update_id: 9, message: privateMessage(9, "https://t.me/+private_invite") });
			expect(String(fake.lastMessage()?.text)).toContain("Нужна публичная ссылка вида https://t.me/channel_name");
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "platform_url" } });
			await bot.handleUpdate({ update_id: 10, message: privateMessage(10, "https://example.com/direct") });
			expect(String(fake.lastMessage()?.text)).toContain("Укажите размер аудитории");
			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({ state: { step: "audience", draft: { platform: { platformType: "other", url: "https://example.com/direct" } } } });
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("offers the current Telegram username as an explicit public platform opt-in", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-personal-telegram-"));
		const databasePath = join(directory, "app.sqlite");
		const clock = new FakeClock(1_700_000_000_000);
		const fake = createFakeTelegramApi();
		const boundary = new DatabaseBoundary(databasePath);
		try {
			const source = await MigrationSource.fromDirectory(migrationsPath);
			await new MigrationRunner(source, clock).migrate(boundary);
			const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			registerTelegramRouter(bot, {
				profileService: new ProfileService(new SqliteProfileRepository(boundary), new DatabaseBoundaryTransactionRunner(boundary), clock),
				sessionRepository: new SqliteProfileSessionRepository(boundary),
				telegramUserRepository: new SqliteTelegramUserRepository(boundary),
				durableCommandExecutor: new DurableCommandExecutor(new DatabaseBoundaryTransactionRunner(boundary), new SqliteDurableCommandStore(boundary), { hash: hashCanonicalInput }, clock),
				clock,
				helpContact: "@helpdesk",
			});
			await bot.init();
			await bot.handleUpdate({ update_id: 1, message: privateMessage(1, "/profile") });
			await bot.handleUpdate({ update_id: 2, callback_query: callback(2, "profile:create") });
			await bot.handleUpdate({ update_id: 3, message: privateMessage(3, "Блогер") });
			await bot.handleUpdate({ update_id: 4, message: privateMessage(4, "Alice Creator") });
			await bot.handleUpdate({ update_id: 5, message: privateMessage(5, "-") });
			await bot.handleUpdate({ update_id: 6, message: privateMessage(6, "-") });

			const personalCallback = callbackData(fake, "profile:platform:self");
			expect(personalCallback).not.toContain("alice");
			expect(fake.lastMessage()?.reply_markup?.inline_keyboard?.flat()).toContainEqual(expect.objectContaining({ text: "Использовать @alice" }));
			expect(String(fake.lastMessage()?.text)).toContain("будет видна другим пользователям до принятия отклика");
			await bot.handleUpdate({ update_id: 7, callback_query: callback(7, personalCallback) });

			expect(await new SqliteProfileSessionRepository(boundary).findActive("100", clock.now().getTime())).toMatchObject({
				state: { step: "audience", draft: { platform: { platformType: "telegram", url: "https://t.me/alice", username: "alice" } } },
			});
		} finally {
			await boundary.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

function privateMessage(messageId: number, text?: string) {
	return privateMessageForUser(messageId, 100, text, "alice", "Alice");
}

function callback(id: number, data: string) {
	return callbackForUser(id, 100, data, "alice", "Alice");
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
