export interface ProfilesApi {
	findOwnProfile(telegramUserId: string): Promise<unknown>;
}
