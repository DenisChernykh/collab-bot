export const PRODUCT_EVENT_TYPES = [
	"bot_started",
	"profile_started",
	"profile_completed",
	"collaboration_draft_started",
	"collaboration_published",
	"collaboration_viewed",
	"application_submitted",
	"application_accepted",
	"collaboration_matched",
	"completion_reported",
	"collaboration_bilateral_confirmed",
	"collaboration_hidden",
	"user_blocked",
] as const;

export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

declare const safeAttributesBrand: unique symbol;
export type SafeAttributes = Readonly<Record<string, boolean | number | string>> & {
	readonly [safeAttributesBrand]: true;
};

export interface ProductEventRecord {
	readonly eventId: string;
	readonly eventType: ProductEventType;
	readonly idempotencyKey: string;
	readonly actorTelegramUserId: string | null;
	readonly profileId: string | null;
	readonly collaborationId: string | null;
	readonly applicationId: string | null;
	readonly safeAttributes: SafeAttributes;
	readonly occurredAt: number;
}

export interface ProductEventAppendRequest {
	readonly eventId: string;
	readonly eventType: ProductEventType;
	readonly idempotencyKey: string;
	readonly actorTelegramUserId?: string;
	readonly profileId?: string;
	readonly collaborationId?: string;
	readonly applicationId?: string;
	readonly safeAttributes: SafeAttributes;
	readonly occurredAt?: number;
}
