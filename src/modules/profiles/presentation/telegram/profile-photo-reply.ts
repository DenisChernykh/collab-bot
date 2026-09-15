import type { Context } from "grammy";
import type { MfmPhoto } from "../../domain/mfm-profile.js";

export async function replyWithProfilePhoto(ctx: Context, text: string, photo: MfmPhoto | null | undefined, options?: Parameters<Context["reply"]>[1]): Promise<void> {
 if (photo == null || photo.botId !== String(ctx.me.id)) { await ctx.reply(text, options); return; }
 if (text.length <= 1024) {
  try { await ctx.replyWithPhoto(photo.fileId, { caption: text, ...(options?.reply_markup === undefined ? {} : { reply_markup: options.reply_markup }) }); }
  catch { await ctx.reply(text, options); }
 } else {
  try { await ctx.replyWithPhoto(photo.fileId); } catch { /* The full text still follows. */ }
  await ctx.reply(text, options);
 }
}
