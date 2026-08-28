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
	/** Telegram retry_after seconds; nextAttemptAt remains UTC milliseconds. */
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
	cancelUnclaimed(id: string, updatedAt: number): Promise<boolean>;
	supersede(id: string, updatedAt: number): Promise<void>;
	claimDue(now: number, claimToken: string, requestDeadlineAt: number, allowedKinds?: readonly OutboxDeliveryKind[]): Promise<OutboxDeliveryRecord | undefined>;
	markSent(id: string, claimToken: string, updatedAt: number, messageId: number): Promise<boolean>;
	markRetryable(
		id: string,
		claimToken: string,
		updatedAt: number,
		nextAttemptAt: number,
		lastErrorKind: DeliveryErrorKind,
		telegramRetryAfter: number | null,
	): Promise<boolean>;
	markAmbiguous(id: string, claimToken: string, updatedAt: number, lastErrorKind: DeliveryErrorKind): Promise<boolean>;
	markPermanent(id: string, claimToken: string, updatedAt: number, lastErrorKind: DeliveryErrorKind): Promise<boolean>;
	recoverStale(now: number, staleBefore: number, retryAtByAttempt: readonly (number | null)[]): Promise<number>;
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
