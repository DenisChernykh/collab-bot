import { Bot, Composer, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe, Update } from "grammy/types";
import { describe, expect, it } from "vitest";

import {
	CollaborationDraftStaleError,
	createCollaborationTelegramFeature,
	type CollaborationDraftCommands,
	type CollaborationDraftInput,
	type CollaborationDraftStartResult,
	type CollaborationRecord,
	type CollaborationSessionRecord,
	type CollaborationWizardStep,
} from "../../src/modules/collaborations/index.js";
import { FakeTelegramApi } from "../support/fake-telegram-api.js";

const NOW = 1_700_000_000_000;

describe("R1-05B collaboration Telegram composer", () => {
	it("rejects stale and replayed callbacks without applying a second draft transition", async () => {
		const drafts = new InMemoryCollaborationDrafts();
		const harness = await createHarness(drafts);

		await harness.bot.handleUpdate(message(1, "/new"));
		const started = drafts.session;
		expect(started).toMatchObject({ state: { step: "format" }, revision: 1 });
		if (started === undefined) throw new Error("collaboration session was not created");

		await harness.bot.handleUpdate(callback(2, "collaboration:format:barter:gbbbbbbbbbbbbbbbb:r1"));
		expect(drafts.saveCalls).toBe(0);
		expect(String(harness.fake.lastMessage()?.text)).toBe("Этот экран уже устарел. Откройте продолжение коллаборации из меню.");

		const formatCallback = `collaboration:format:barter:g${started.state.generation}:r${started.revision}`;
		await harness.bot.handleUpdate(callback(3, formatCallback));
		expect(drafts.saveCalls).toBe(1);
		expect(drafts.session).toMatchObject({ state: { format: "barter", step: "target_profile_type" }, revision: 2 });

		await harness.bot.handleUpdate(callback(4, formatCallback));
		expect(drafts.saveCalls).toBe(1);
		expect(drafts.session).toMatchObject({ state: { format: "barter", step: "target_profile_type" }, revision: 2 });
		expect(String(harness.fake.lastMessage()?.text)).toBe("Этот экран уже устарел. Откройте продолжение коллаборации из меню.");
	});

	it("resumes after a bot restart while a root command stays ahead of the active session", async () => {
		const drafts = new InMemoryCollaborationDrafts();
		const first = await createHarness(drafts);
		await first.bot.handleUpdate(message(1, "/new"));
		const started = drafts.session;
		if (started === undefined) throw new Error("collaboration session was not created");
		await first.bot.handleUpdate(callback(2, `collaboration:format:joint_content:g${started.state.generation}:r${started.revision}`));

		const restarted = await createHarness(drafts);
		await restarted.bot.handleUpdate(message(3, "/start"));
		expect(String(restarted.fake.lastMessage()?.text)).toBe("root start");
		expect(drafts.session).toMatchObject({ state: { step: "target_profile_type" }, revision: 2 });

		await restarted.bot.handleUpdate(message(4, "/new"));
		expect(String(restarted.fake.lastMessage()?.text)).toBe("Кого вы ищете в партнёры?");
		expect(drafts.startCalls).toBe(2);

		await restarted.bot.handleUpdate(message(5, "/cancel"));
		expect(drafts.cancelCalls).toBe(1);
		expect(drafts.session).toBeUndefined();
		expect(String(restarted.fake.lastMessage()?.text)).toBe("Черновик коллаборации отменён.");
	});
});

async function createHarness(drafts: InMemoryCollaborationDrafts): Promise<{ readonly bot: Bot; readonly fake: FakeTelegramApi }> {
	const fake = new FakeTelegramApi({
		token: "fake-token",
		botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
	});
	const feature = createCollaborationTelegramFeature({
		draftService: drafts,
		menuKeyboard: () => new InlineKeyboard().text("Menu", "menu:home"),
		profileFlow: {
			findSession: async () => undefined,
			hasOwnProfile: async () => true,
			startForCollaboration: async () => {},
			resumeKeyboard: () => new InlineKeyboard().text("Profile", "profile:resume"),
		},
		renderManagedCollaborations: async () => [],
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
	return { bot, fake };
}

class InMemoryCollaborationDrafts implements CollaborationDraftCommands {
	session: CollaborationSessionRecord | undefined;
	draft: CollaborationRecord | undefined;
	startCalls = 0;
	saveCalls = 0;
	cancelCalls = 0;

	async start(telegramUserId: string): Promise<CollaborationDraftStartResult> {
		this.startCalls += 1;
		this.draft ??= draftRecord(telegramUserId);
		this.session ??= {
			telegramUserId,
			collaborationId: this.draft.id,
			state: { version: 1, generation: "aaaaaaaaaaaaaaaa", step: "format" },
			revision: 1,
			expiresAt: NOW + 100_000,
			updatedAt: NOW,
		};
		return { draft: this.draft, session: this.session, resumed: this.startCalls > 1 };
	}

	async saveStep(
		telegramUserId: string,
		expected: Pick<CollaborationSessionRecord, "collaborationId" | "revision" | "state">,
		input: CollaborationDraftInput,
		nextStep: CollaborationWizardStep,
	): Promise<CollaborationDraftStartResult> {
		const current = this.session;
		if (current === undefined || current.collaborationId !== expected.collaborationId || current.revision !== expected.revision || current.state.generation !== expected.state.generation) throw new CollaborationDraftStaleError();
		this.saveCalls += 1;
		this.session = {
			...current,
			state: { ...current.state, ...input, step: nextStep },
			revision: current.revision + 1,
			updatedAt: NOW,
		};
		this.draft = { ...this.draft!, ...(input.format === undefined ? {} : { format: input.format }), updatedAt: NOW };
		return { draft: this.draft, session: this.session, resumed: true };
	}

	async cancel(telegramUserId: string, expected?: Pick<CollaborationSessionRecord, "collaborationId" | "revision" | "state">): Promise<boolean> {
		const current = this.session;
		if (expected !== undefined && (current === undefined || current.collaborationId !== expected.collaborationId || current.revision !== expected.revision || current.state.generation !== expected.state.generation)) throw new CollaborationDraftStaleError();
		this.cancelCalls += 1;
		this.session = undefined;
		this.draft = undefined;
		return true;
	}

	async findDraft(): Promise<CollaborationRecord | undefined> { return this.draft; }
	async findSession(): Promise<CollaborationSessionRecord | undefined> { return this.session; }
}

function draftRecord(telegramUserId: string): CollaborationRecord {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		publicToken: null,
		authorProfileId: "22222222-2222-4222-8222-222222222222",
		authorTelegramUserId: telegramUserId,
		format: null,
		targetProfileType: null,
		topics: [],
		title: null,
		offerText: null,
		expectationText: null,
		slotsTotal: null,
		responseDeadlineAt: null,
		eventDateLocal: null,
		cityCode: "ekaterinburg",
		status: "draft",
		version: 1,
		projectionRevision: 0,
		createdAt: NOW,
		updatedAt: NOW,
	};
}

function message(updateId: number, text: string): Update {
	return {
		update_id: updateId,
		message: {
			message_id: updateId,
			date: Math.floor(NOW / 1_000),
			chat: { id: 100, type: "private", first_name: "Alice" },
			from: { id: 100, is_bot: false, first_name: "Alice", username: "alice" },
			text,
		},
	};
}

function callback(updateId: number, data: string): Update {
	return {
		update_id: updateId,
		callback_query: {
			id: `callback-${updateId}`,
			chat_instance: "chat-instance",
			from: { id: 100, is_bot: false, first_name: "Alice", username: "alice" },
			message: message(updateId, "menu").message!,
			data,
		},
	};
}
