import { renderIntroduction } from "../../src/modules/connections/presentation/telegram/introduction-presentation.js";
import type { IntroductionView } from "../../src/modules/connections/application/index.js";
import { expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { replyWithProfilePhoto } from "../../src/modules/profiles/presentation/telegram/profile-photo-reply.js";
import { renderConnection } from "../../src/modules/connections/presentation/telegram/connection-presentation.js";
import type { ConnectionView } from "../../src/modules/connections/application/index.js";
const photo = { fileId: "saved_photo", botId: "777" };
const profile = { profileId: "synthetic", displayName: "Synthetic", eventStatus: "participant" as const, profileType: "media" as const, locationText: "City", spheres: ["media" as const], openTo: ["joint_projects" as const], about: null, photo };
const view: ConnectionView = { kind: "profile", language: "ru", festivalEnabled: true, visible: true, profile, person: null, hasNext: false, session: { state: { version: 1, generation: "a".repeat(16), screen: "profile", filters: {}, offset: 0 }, revision: 1, updatedAt: 1 } };
it("renders only the displayed saved profile photo, never an empty search/filter photo", () => {
 expect(renderConnection(view)).toMatchObject({ photo });
 expect(JSON.stringify(renderConnection(view).keyboard)).toContain("mfm:photo");
 expect(renderConnection({ ...view, kind: "search", person: { ...profile, photo: { ...photo, fileId: "other" } } })).toMatchObject({ photo: { ...photo, fileId: "other" } });
 expect(renderConnection({ ...view, kind: "search" })).not.toHaveProperty("photo");
 expect(renderConnection({ ...view, kind: "filter" })).not.toHaveProperty("photo");
});
it("keeps long text and navigation complete and refuses another bot's file reference", async () => {
 const reply = vi.fn().mockResolvedValue(undefined); const replyWithPhoto = vi.fn().mockResolvedValue(undefined);
 const ctx = { me: { id: 777 }, reply, replyWithPhoto } as unknown as Context;
 const options = { reply_markup: new InlineKeyboard().text("Next", "next") };
 await replyWithProfilePhoto(ctx, "short", photo, options);
 expect(replyWithPhoto).toHaveBeenCalledWith("saved_photo", { caption: "short", ...options }); expect(reply).not.toHaveBeenCalled();
 const long = "a".repeat(1025); await replyWithProfilePhoto(ctx, long, photo, options);
 expect(replyWithPhoto).toHaveBeenLastCalledWith("saved_photo", undefined); expect(reply).toHaveBeenLastCalledWith(long, options);
 replyWithPhoto.mockClear(); await replyWithProfilePhoto(ctx, "other bot", { ...photo, botId: "999" }, options);
 expect(replyWithPhoto).not.toHaveBeenCalled(); expect(reply).toHaveBeenLastCalledWith("other bot", options);
 replyWithPhoto.mockRejectedValue(new Error("missing photo")); await replyWithProfilePhoto(ctx, "fallback", photo, options);
 expect(reply).toHaveBeenLastCalledWith("fallback", options);
 const recovery = { text: "Choose another photo", options: { reply_markup: new InlineKeyboard().text("Retry", "retry") } };
 await replyWithProfilePhoto(ctx, "Confirm unseen photo", photo, options, recovery);
 expect(reply).toHaveBeenLastCalledWith(recovery.text, recovery.options);
});

it("attaches photos only to authorized introduction screens that render the person's profile", () => {
 const intro: IntroductionView = { kind: "request", language: "ru", festivalEnabled: true, session: view.session, person: profile, request: { token: "synthetic", status: "pending", revision: 1, message: "Synthetic introduction" }, message: null, contactUrl: null, canAccept: true, canWithdraw: false, hasNext: false };
 expect(renderIntroduction(intro)).toMatchObject({ photo });
 expect(renderIntroduction({ ...intro, kind: "list" })).toMatchObject({ photo });
 expect(renderIntroduction({ ...intro, kind: "compose" })).not.toHaveProperty("photo");
 expect(renderIntroduction({ ...intro, person: null })).not.toHaveProperty("photo");
 expect(renderIntroduction({ kind: "unavailable" })).not.toHaveProperty("photo");
 expect(JSON.stringify(renderIntroduction(intro))).not.toContain("tg://user");
});
