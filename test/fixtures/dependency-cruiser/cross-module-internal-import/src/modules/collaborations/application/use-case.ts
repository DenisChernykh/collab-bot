import type { InternalProfileRepository } from "../../profiles/application/internal.js";

export function findAuthorProfile(repository: InternalProfileRepository, telegramUserId: string): Promise<unknown> {
	return repository.findOwnProfile(telegramUserId);
}
