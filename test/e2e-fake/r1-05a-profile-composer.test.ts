import { Bot, Composer, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe, Update } from "grammy/types";
import { describe, expect, it } from "vitest";

import type { Clock } from "../../src/application/ports/clock.js";
import {
	createProfileTelegramFeature,
	type ProfileInput,
	type ProfileRecord,
	type ProfileService,
	type ProfileSessionRecord,
	type ProfileSessionRepository,
} from "../../src/modules/profiles/index.js";
import { FakeTelegramApi } from "../support/fake-telegram-api.js";

const NOW = 1_700_000_000_000;

describe("R1-05A profile Telegram composer", () => {
	it("owns the ordinary profile entry while a root command stays ahead of the active session", async () => {
		const harness = await createHarness();

		await harness.bot.handleUpdate(message(1, "/profile"));
		expect(String(harness.fake.lastMessage()?.text)).toBe("У вас пока нет профиля. Создайте его, чтобы представиться будущим партнёрам.");
		await harness.bot.handleUpdate(callback(2, "profile:create"));
		const started = await harness.sessions.findActive("100", NOW);
		expect(started).toMatchObject({ state: { step: "type" }, revision: 1 });

		const repliesBeforeMalformedCallback = harness.fake.calls.filter((call) => call.method === "sendMessage").length;
		await harness.bot.handleUpdate(callback(3, "profile:type:blogger:gbad:r1"));
		expect(await harness.sessions.findActive("100", NOW)).toEqual(started);
		expect(harness.fake.calls.filter((call) => call.method === "sendMessage")).toHaveLength(repliesBeforeMalformedCallback);

		await harness.bot.handleUpdate(message(4, "/start"));
		expect(String(harness.fake.lastMessage()?.text)).toBe("root start");
		expect(await harness.sessions.findActive("100", NOW)).toEqual(started);

		if (started === undefined) throw new Error("profile session was not created");
		await harness.bot.handleUpdate(callback(5, `profile:type:blogger:g${started.state.generation}:r${started.revision}`));
		expect(await harness.sessions.findActive("100", NOW)).toMatchObject({ state: { step: "display_name", draft: { type: "blogger" } } });
	});

	it("keeps a root command ahead of a quick-profile continuation and resumes the application step", async () => {
		const harness = await createHarness();
		await harness.sessions.save({
			telegramUserId: "100",
			state: {
				version: 1,
				generation: "dddddddddddddddd",
				step: "platform",
				draft: { type: "blogger", displayName: "Quick Creator", description: null, topics: [], audienceAutofill: "allow" },
				continuation: { kind: "submit_application", collaborationId: "11111111-1111-4111-8111-111111111111", source: "deep_link" },
			},
			revision: 1,
			expiresAt: NOW + 100_000,
			updatedAt: NOW,
		});

		await harness.bot.handleUpdate(message(1, "/start", "quick_creator"));
		expect(String(harness.fake.lastMessage()?.text)).toBe("root start");
		expect(await harness.sessions.findActive("100", NOW)).toMatchObject({ state: { step: "platform" }, revision: 1 });

		await harness.bot.handleUpdate(callback(2, "profile:platform:self:gdddddddddddddddd:r1", "quick_creator"));
		expect(harness.profile()).toMatchObject({
			displayName: "Quick Creator",
			platforms: [{ platformType: "telegram", url: "https://t.me/quick_creator", username: "quick_creator" }],
		});
		expect(await harness.sessions.findActive("100", NOW)).toMatchObject({
			state: {
				step: "application_message",
				continuation: { kind: "submit_application", collaborationId: "11111111-1111-4111-8111-111111111111" },
			},
		});
		const replies = harness.fake.calls.filter((call) => call.method === "sendMessage").map((call) => String(call.payload.text));
		expect(replies.slice(-2)).toEqual([
			"Профиль сохранён. Теперь добавьте сообщение автору коллаборации.",
			"Напишите сообщение автору: почему вам интересна коллаборация и что вы можете предложить (10–500 символов).",
		]);
	});
});

async function createHarness(): Promise<{
	readonly bot: Bot;
	readonly fake: FakeTelegramApi;
	readonly sessions: InMemoryProfileSessions;
	readonly profile: () => ProfileRecord | undefined;
}> {
	const fake = new FakeTelegramApi({
		token: "fake-token",
		botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
	});
	const sessions = new InMemoryProfileSessions();
	let profile: ProfileRecord | undefined;
	const profileService = {
		getOwn: async () => profile,
		create: async (telegramUserId: string, input: ProfileInput) => {
			profile = profileRecord(telegramUserId, input);
			return profile;
		},
		update: async (telegramUserId: string, input: ProfileInput) => {
			profile = profileRecord(telegramUserId, input);
			return profile;
		},
	} as unknown as ProfileService;
	const feature = createProfileTelegramFeature({
		profileService,
		sessionRepository: sessions,
		clock: { now: () => new Date(NOW) } satisfies Clock,
		requestIdFactory: () => 12345,
		applicationService: { checkEligibility: async () => ({ ok: true }) } as never,
		menuKeyboard: () => new InlineKeyboard().text("Menu", "menu:home"),
		isCollaborationActive: async () => false,
		continueCreateCollaboration: async () => undefined,
		scheduleProfileAudience: () => {},
		reopenApplicationCard: async () => {},
		replyApplicationFailure: async () => {},
		occurredAt: () => NOW,
	});
	const root = new Composer<Context>();
	root.on("message:text", async (ctx, next) => {
		if (ctx.message.text.trim().split(/\s+/, 1)[0]?.toLowerCase() !== "/start") {
			await next();
			return;
		}
		await ctx.reply("root start");
	});
	root.on("callback_query:data", async (ctx, next) => {
		await ctx.answerCallbackQuery();
		await next();
	});
	root.use(feature.composer);
	const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
	bot.use(root);
	await bot.init();
	return { bot, fake, sessions, profile: () => profile };
}

class InMemoryProfileSessions implements ProfileSessionRepository {
	private readonly sessions = new Map<string, ProfileSessionRecord>();

	async findActive(telegramUserId: string, now: number): Promise<ProfileSessionRecord | undefined> {
		const session = this.sessions.get(telegramUserId);
		return session !== undefined && session.expiresAt > now ? session : undefined;
	}

	async save(record: ProfileSessionRecord): Promise<void> {
		this.sessions.set(record.telegramUserId, record);
	}

	async delete(telegramUserId: string): Promise<void> {
		this.sessions.delete(telegramUserId);
	}
}

function profileRecord(telegramUserId: string, input: ProfileInput): ProfileRecord {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		telegramUserId,
		...input,
		cityCode: "ekaterinburg",
		status: "active",
		createdAt: NOW,
		updatedAt: NOW,
		platforms: input.platforms.map((platform) => ({ id: "33333333-3333-4333-8333-333333333333", ...platform })),
	};
}

function message(updateId: number, text: string, username = "alice"): Update {
	return {
		update_id: updateId,
		message: {
			message_id: updateId,
			date: Math.floor(NOW / 1_000),
			chat: { id: 100, type: "private", first_name: "Alice" },
			from: { id: 100, is_bot: false, first_name: "Alice", username },
			text,
		},
	};
}

function callback(updateId: number, data: string, username = "alice"): Update {
	return {
		update_id: updateId,
		callback_query: {
			id: `callback-${updateId}`,
			chat_instance: "chat-instance",
			from: { id: 100, is_bot: false, first_name: "Alice", username },
			message: message(updateId, "menu", username).message!,
			data,
		},
	};
}
