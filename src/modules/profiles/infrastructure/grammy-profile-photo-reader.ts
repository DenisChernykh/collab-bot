import type { Bot } from "grammy";
import type { ProviderDeadline } from "../../../shared/application/ports/provider-deadline.js";
import type { ProfilePhotoReader } from "../application/ports/profile-photo-reader.js";
import { validateMfmPhoto, type MfmPhoto } from "../domain/mfm-profile.js";

export class GrammyProfilePhotoReader implements ProfilePhotoReader {
 constructor(private readonly bot: Pick<Bot, "api">, private readonly deadline: ProviderDeadline) {}
 async read(userId: string, botId: string): Promise<MfmPhoto | null> {
  try {
   const result = await this.deadline.run(undefined, signal => this.bot.api.getUserProfilePhotos(Number(userId), { offset: 0, limit: 1 }, signal as never));
   const sizes = result.photos[0];
   const largest = sizes?.reduce((best, size) => size.width * size.height > best.width * best.height ? size : best);
   return largest === undefined ? null : validateMfmPhoto({ fileId: largest.file_id, botId });
  } catch { return null; }
 }
}
