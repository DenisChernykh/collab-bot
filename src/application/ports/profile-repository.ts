import type {
	ProfileInput,
	ProfileRecord,
	PublicProfileRecord,
} from "../../domain/profiles/profile.js";

export interface ProfileRepository {
	findActiveByTelegramUserId(telegramUserId: string): Promise<ProfileRecord | undefined>;
	findPublicById(profileId: string): Promise<PublicProfileRecord | undefined>;
	create(telegramUserId: string, input: ProfileInput, now: number): Promise<ProfileRecord>;
	update(telegramUserId: string, input: ProfileInput, now: number): Promise<ProfileRecord>;
}
