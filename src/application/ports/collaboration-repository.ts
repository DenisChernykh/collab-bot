import type { CollaborationDraftInput, CollaborationRecord } from "../../domain/collaborations/collaboration.js";

export interface CollaborationRepository {
	findDraftByTelegramUserId(telegramUserId: string): Promise<CollaborationRecord | undefined>;
	findDraftByIdForTelegramUser(telegramUserId: string, collaborationId: string): Promise<CollaborationRecord | undefined>;
	createDraft(telegramUserId: string, now: number): Promise<CollaborationRecord>;
	replaceDraft(telegramUserId: string, collaborationId: string, input: CollaborationDraftInput, now: number): Promise<CollaborationRecord>;
	deleteDraft(telegramUserId: string, collaborationId: string): Promise<boolean>;
}
