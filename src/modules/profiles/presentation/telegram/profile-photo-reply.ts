import type { Context } from "grammy";
import type { MfmPhoto } from "../../domain/mfm-profile.js";

export interface ProfilePhotoFallback {
 readonly text: string;
 readonly options?: Parameters<Context["reply"]>[1];
}
export const PROFILE_PHOTO_REPLY = Symbol("profile-photo-reply");
export type ProfilePhotoReplyContext = Context & {
 readonly [PROFILE_PHOTO_REPLY]?: (fileId: string, options: Parameters<Context["replyWithPhoto"]>[1], fallback?: ProfilePhotoFallback) => Promise<void>;
};

export async function replyWithProfilePhoto(ctx: Context, text: string, photo: MfmPhoto | null | undefined, options?: Parameters<Context["reply"]>[1], fallback?: ProfilePhotoFallback): Promise<void> {
 if (photo == null) { await ctx.reply(text, options); return; }
 if (photo.botId !== String(ctx.me.id)) { await ctx.reply(fallback?.text ?? text, fallback?.options ?? options); return; }
 const caption = text.length <= 1024 ? text : undefined;
 const photoOptions = caption === undefined ? undefined : { caption, ...(options?.reply_markup === undefined ? {} : { reply_markup: options.reply_markup }) };
 const buffer = (ctx as ProfilePhotoReplyContext)[PROFILE_PHOTO_REPLY];
 if (buffer !== undefined) await buffer(photo.fileId, photoOptions, fallback);
 else {
  try { await ctx.replyWithPhoto(photo.fileId, photoOptions); }
  catch {
   if (fallback !== undefined) { await ctx.reply(fallback.text, fallback.options); return; }
   if (caption !== undefined) { await ctx.reply(text, options); return; }
  }
 }
 if (caption === undefined) await ctx.reply(text, options);
}
