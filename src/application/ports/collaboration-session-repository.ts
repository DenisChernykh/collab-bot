import type { CollaborationDraftState } from "../../domain/collaborations/collaboration.js";

export { COLLABORATION_SESSION_TTL_MS, COLLABORATION_SESSION_VERSION } from "../../domain/collaborations/collaboration.js";

export interface CollaborationSessionRecord {
	readonly telegramUserId: string;
	readonly collaborationId: string;
	readonly state: CollaborationDraftState;
	readonly revision: number;
	readonly expiresAt: number;
	readonly updatedAt: number;
}

export interface CollaborationSessionRepository {
	findActive(telegramUserId: string, now: number): Promise<CollaborationSessionRecord | undefined>;
	save(record: CollaborationSessionRecord): Promise<void>;
	delete(telegramUserId: string): Promise<void>;
}
