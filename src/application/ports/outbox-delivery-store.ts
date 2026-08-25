import type { DeliveryPayload } from "../outbox/delivery-payload.js";

export const OUTBOX_DELIVERY_KINDS = ["dm_send", "channel_send", "channel_edit", "channel_delete"] as const;
export type OutboxDeliveryKind = (typeof OUTBOX_DELIVERY_KINDS)[number];

export const OUTBOX_DELIVERY_STATUSES = [
	"prepared",
	"dispatching",
	"sent",
	"retryable_failed",
	"ambiguous",
	"permanent_failed",
	"superseded",
	"cancelled",
] as const;
export type OutboxDeliveryStatus = (typeof OUTBOX_DELIVERY_STATUSES)[number];

export const DELIVERY_ERROR_KINDS = [
	"rate_limited",
	"network",
	"provider_timeout",
	"forbidden",
	"invalid_chat",
	"not_found",
	"unknown",
] as const;
export type DeliveryErrorKind = (typeof DELIVERY_ERROR_KINDS)[number];

export interface OutboxDeliveryRecord {
	readonly id: string;
	readonly idempotencyKey: string;
	readonly kind: OutboxDeliveryKind;
	readonly recipientChatId: string;
	readonly messageId: number | null;
	readonly payload: DeliveryPayload;
	readonly status: OutboxDeliveryStatus;
	readonly attemptCount: number;
	readonly claimToken: string | null;
	readonly dispatchStartedAt: number | null;
	readonly requestDeadlineAt: number | null;
	readonly nextAttemptAt: number | null;
	readonly telegramRetryAfter: number | null;
	readonly lastErrorKind: DeliveryErrorKind | null;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface OutboxDeliveryStore {
	findById(id: string): Promise<OutboxDeliveryRecord | undefined>;
	findByIdempotencyKey(idempotencyKey: string): Promise<OutboxDeliveryRecord | undefined>;
	insert(record: OutboxDeliveryRecord): Promise<void>;
	cancel(id: string, updatedAt: number): Promise<void>;
	supersede(id: string, updatedAt: number): Promise<void>;
}

export class OutboxStoreCorruptError extends Error {
	constructor() {
		super("outbox delivery row is corrupt");
		this.name = "OutboxStoreCorruptError";
	}
}

export class OutboxStoreConflictError extends Error {
	constructor() {
		super("outbox delivery store conflict");
		this.name = "OutboxStoreConflictError";
	}
}
