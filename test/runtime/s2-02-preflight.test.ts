import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";

import { createBotRuntime } from "../../src/runtime/bot-runtime.js";
import { preflightShowcase } from "../../src/runtime/showcase-preflight.js";
import { FakeTelegramApi } from "../support/fake-telegram-api.js";
import { SqliteOutboxDeliveryRepository } from "../../src/platform/outbox/outbox-delivery-repository.js";
import type { OutboxDeliveryRecord } from "../../src/shared/application/ports/outbox-delivery-store.js";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("S2-02 showcase preflight", () => {
	it("accepts exact channel and administrator capabilities", async () => {
		const fake = new FakeTelegramApi({ token: "fake", botInfo: { id: 7, is_bot: true, first_name: "Bot", username: "bot" } as unknown as UserFromGetMe });
		const bot = new Bot("fake", { client: { fetch: fake.fetch } });
		await bot.init();
		expect(await preflightShowcase(bot, { showcaseChannelId: "-1001", showcaseChannelUsername: "showcase" })).toEqual({ canPublish: true, reason: null });
	});

	it("degrades without mutating state when capabilities are insufficient", async () => {
		const fake = new FakeTelegramApi({ token: "fake", botInfo: { id: 7, is_bot: true, first_name: "Bot", username: "bot" } as unknown as UserFromGetMe, showcaseMember: { status: "administrator", can_post_messages: true, can_edit_messages: false, can_delete_messages: true } });
		const bot = new Bot("fake", { client: { fetch: fake.fetch } });
		await bot.init();
		expect(await preflightShowcase(bot, { showcaseChannelId: "-1001", showcaseChannelUsername: "showcase" })).toMatchObject({ canPublish: false });
		expect(fake.calls.map((call) => call.method)).toEqual(["getMe", "getChat", "getChatMember"]);
	});

	it("does not claim or dispatch prepared channel deliveries while preflight is degraded", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s2-02-preflight-runtime-"));
		const fake = new FakeTelegramApi({
			token: "fake-token",
			botInfo: { id: 7, is_bot: true, first_name: "Bot", username: "bot" } as unknown as UserFromGetMe,
			showcaseMember: { status: "administrator", can_post_messages: false, can_edit_messages: false, can_delete_messages: false },
		});
		const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
		bot.start = async (options) => { (options?.onStart as (() => void) | undefined)?.(); };
		bot.stop = async () => {};
		let runtime: Awaited<ReturnType<typeof createBotRuntime>> | undefined;
		const delivery: OutboxDeliveryRecord = {
			id: "11111111-1111-4111-8111-111111111111",
			idempotencyKey: "collaboration:test:channel_send:1",
			kind: "channel_send",
			recipientChatId: "-1001",
			messageId: null,
			payload: { version: 1, method: "send", text: "prepared showcase card" },
			status: "prepared",
			attemptCount: 0,
			claimToken: null,
			dispatchStartedAt: null,
			requestDeadlineAt: null,
			nextAttemptAt: null,
			telegramRetryAfter: null,
			lastErrorKind: null,
			createdAt: 1_700_000_000_000,
			updatedAt: 1_700_000_000_000,
		};
		try {
			runtime = await createBotRuntime({
				bot,
				config: {
					botToken: "fake-token", expectedBotId: "7", expectedBotUsername: "bot", adminTelegramIds: [],
					showcaseChannelId: "-1001", showcaseChannelUsername: "showcase", databasePath: join(directory, "app.sqlite"),
					logLevel: "info", timeZone: "Asia/Yekaterinburg", helpContact: "@helpdesk",
				},
				migrationsDirectory,
			});
			await new SqliteOutboxDeliveryRepository(runtime.boundary).insert(delivery);
			await runtime.start();
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			expect(fake.calls.filter((call) => ["sendMessage", "editMessageText", "deleteMessage"].includes(call.method))).toHaveLength(0);
			expect(await new SqliteOutboxDeliveryRepository(runtime.boundary).findById(delivery.id)).toMatchObject({ status: "prepared", attemptCount: 0 });
		} finally {
			await runtime?.shutdown();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
