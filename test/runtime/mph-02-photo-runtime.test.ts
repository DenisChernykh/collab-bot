import { expect, it, vi } from "vitest";
import { Bot, Context } from "grammy";
import { ReplyCollector } from "../../src/runtime/telegram/telegram-router.js";
import { GrammyProfilePhotoReader } from "../../src/modules/profiles/infrastructure/grammy-profile-photo-reader.js";
import { privateMessageForUser } from "../support/fake-telegram.js";
import type { ProviderDeadline } from "../../src/shared/application/ports/provider-deadline.js";

const botInfo = { id: 123, is_bot: true as const, first_name: "Synthetic", username: "synthetic_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };
const deadline: ProviderDeadline = { run: async (_shutdown, operation) => operation(new AbortController().signal) };
it("buffers media and text in order until dispatch, with text fallback", async () => {
 const bot = new Bot("123:synthetic", { botInfo });
 const calls: string[] = [];
 bot.api.config.use(async (_previous, method) => { calls.push(method); return { ok: true, result: true } as never; });
 const ctx = new Context({ update_id: 1, message: privateMessageForUser(1, 1, "test") }, bot.api, botInfo);
 const collector = new ReplyCollector(); const work = collector.context(ctx);
 await work.reply("first"); await work.replyWithPhoto("synthetic_photo", { caption: "profile" }); await work.reply("last");
 expect(calls).toEqual([]);
 await collector.dispatchReplies(ctx);
 expect(calls).toEqual(["sendMessage", "sendPhoto", "sendMessage"]);
 const fallback = new ReplyCollector(); await fallback.context(ctx).replyWithPhoto("missing", { caption: "complete profile" });
 const reply = vi.spyOn(ctx, "reply").mockResolvedValue(undefined as never);
 vi.spyOn(ctx, "replyWithPhoto").mockRejectedValue(new Error("unavailable"));
 await fallback.dispatchReplies(ctx);
 expect(reply).toHaveBeenCalledWith("complete profile", undefined);
});
it("reads only the first accessible photo, largest size, and fails softly", async () => {
 const bot = new Bot("123:synthetic", { botInfo });
 const get = vi.spyOn(bot.api, "getUserProfilePhotos").mockResolvedValue({ total_count: 2, photos: [[{ file_id: "small", file_unique_id: "s", width: 20, height: 20 }, { file_id: "large", file_unique_id: "l", width: 640, height: 640 }]] });
 const reader = new GrammyProfilePhotoReader(bot, deadline);
 expect(await reader.read("1", "123")).toEqual({ fileId: "large", botId: "123" });
 expect(get).toHaveBeenCalledWith(1, { offset: 0, limit: 1 }, expect.any(AbortSignal));
 get.mockResolvedValue({ total_count: 0, photos: [] }); expect(await reader.read("1", "123")).toBeNull();
 get.mockRejectedValue(new Error("timeout")); expect(await reader.read("1", "123")).toBeNull();
});
