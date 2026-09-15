import type { MfmPhoto } from "../../domain/mfm-profile.js";
export interface ProfilePhotoReader {
 read(userId: string, botId: string): Promise<MfmPhoto | null>;
}
