import type { ProfilesApi } from "../../profiles/index.js";

export function findAuthorProfile(api: ProfilesApi, telegramUserId: string): Promise<unknown> {
	return api.findOwnProfile(telegramUserId);
}
