import type { CollaborationFormat, ProfileType, Topic } from "../../../../domain/value-objects/enums.js";
import type { CollaborationRecord } from "../../../collaborations/application/index.js";

export interface BrowseFilters {
	readonly targetProfileType: ProfileType | null;
	readonly format: CollaborationFormat | null;
	readonly topic: Topic | null;
}

export interface BrowseCursor {
	readonly publishedAt: number;
	readonly collaborationId: string;
}

export interface BrowseSessionRecord {
	readonly telegramUserId: string;
	readonly generation: string;
	readonly filters: BrowseFilters;
	readonly cursor: BrowseCursor | null;
	readonly revision: number;
	readonly expiresAt: number;
	readonly updatedAt: number;
}

export type BrowseSessionIdentity = Pick<BrowseSessionRecord, "generation" | "revision">;

export type BrowseCollaborationRecord = CollaborationRecord & {
	readonly publishedAt: number | null;
};

export interface FindNextBrowseCardInput {
	readonly viewerTelegramUserId: string;
	readonly now: number;
	readonly filters: BrowseFilters;
	readonly cursor: BrowseCursor | null;
}

export interface FindBrowseCardByIdInput {
	readonly collaborationId: string;
	readonly viewerTelegramUserId: string;
	readonly now: number;
	readonly filters: BrowseFilters;
}

export interface CollaborationBrowseRepository {
	findSession(telegramUserId: string): Promise<BrowseSessionRecord | undefined>;
	saveSession(session: BrowseSessionRecord): Promise<void>;
	deleteExpiredSessions(now: number, limit: number): Promise<number>;
	findNextEligible(input: FindNextBrowseCardInput): Promise<BrowseCollaborationRecord | undefined>;
	findEligibleById(input: FindBrowseCardByIdInput): Promise<BrowseCollaborationRecord | undefined>;
	findByPublicToken(publicToken: string): Promise<BrowseCollaborationRecord | undefined>;
}
