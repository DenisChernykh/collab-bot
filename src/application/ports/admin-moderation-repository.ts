export const HIDEABLE_COLLABORATION_STATUSES = [
	"published",
	"matched",
	"completed",
	"cancelled",
	"expired",
] as const;

export type HideableCollaborationStatus = (typeof HIDEABLE_COLLABORATION_STATUSES)[number];

export type AdminModerationStatus =
	| "draft"
	| "publishing"
	| "published"
	| "publication_failed"
	| "matched"
	| "completed"
	| "cancelled"
	| "expired"
	| "hidden";

export interface AdminModerationTarget {
	readonly collaborationId: string;
	readonly title: string;
	readonly status: AdminModerationStatus;
	readonly projectionRevision: number;
	readonly channelChatId: string | null;
	readonly messageId: number | null;
}

export interface OperatorActionRecord {
	readonly id: string;
	readonly actorTelegramUserId: string;
	readonly collaborationId: string;
	readonly reason: string;
	readonly commandId: string;
	readonly beforeStateJson: string;
	readonly afterStateJson: string;
	readonly createdAt: number;
}

export interface AdminModerationRepository {
	findByPublicToken(publicToken: string): Promise<AdminModerationTarget | undefined>;
	markHidden(input: {
		readonly collaborationId: string;
		readonly expectedStatus: HideableCollaborationStatus;
		readonly expectedProjectionRevision: number;
		readonly hiddenAt: number;
	}): Promise<boolean>;
	closePendingApplications(collaborationId: string): Promise<number>;
	supersedeOlderProjectionDeliveries(input: {
		readonly collaborationId: string;
		readonly beforeProjectionRevision: number;
		readonly updatedAt: number;
	}): Promise<number>;
	attachDeleteDelivery(input: {
		readonly collaborationId: string;
		readonly deliveryId: string;
		readonly updatedAt: number;
	}): Promise<void>;
	appendAction(action: OperatorActionRecord): Promise<void>;
}
