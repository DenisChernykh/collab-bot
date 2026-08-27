export interface InternalProfileRepository {
	findOwnProfile(telegramUserId: string): Promise<unknown>;
}
