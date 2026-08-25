import type { Clock } from "../ports/clock.js";
import type {
	OutboxDeliveryKind,
	OutboxDeliveryRecord,
	OutboxDeliveryStore,
} from "../ports/outbox-delivery-store.js";
import {
	OUTBOX_DELIVERY_KINDS,
	OutboxStoreConflictError,
} from "../ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../ports/transaction-runner.js";
import {
	parseDeliveryPayload,
	serializeDeliveryPayload,
	DeliveryPayloadValidationError,
	type DeliveryPayload,
} from "./delivery-payload.js";

export interface OutboxDeliveryCreateRequest {
	readonly id: string;
	readonly idempotencyKey: string;
	readonly kind: OutboxDeliveryKind;
	readonly recipientChatId: string;
	readonly messageId?: number;
	readonly notBeforeAt?: number;
	readonly payload: DeliveryPayload;
}

export class OutboxValidationError extends Error {
	constructor() {
		super("outbox delivery is invalid");
		this.name = "OutboxValidationError";
	}
}

export class OutboxNotFoundError extends Error {
	constructor() {
		super("outbox delivery was not found");
		this.name = "OutboxNotFoundError";
	}
}

export class OutboxTransitionError extends Error {
	constructor() {
		super("outbox delivery transition is invalid or fenced");
		this.name = "OutboxTransitionError";
	}
}

export class OutboxIdempotencyConflictError extends Error {
	constructor() {
		super("outbox idempotency key conflicts with an existing delivery");
		this.name = "OutboxIdempotencyConflictError";
	}
}

export class OutboxIdConflictError extends Error {
	constructor() {
		super("outbox delivery ID already exists");
		this.name = "OutboxIdConflictError";
	}
}

export class OutboxDeliveryService {
	constructor(
		private readonly store: OutboxDeliveryStore,
		private readonly transactionRunner: TransactionRunner,
		private readonly clock: Clock,
	) {}

	create(request: OutboxDeliveryCreateRequest): Promise<OutboxDeliveryRecord> {
		return this.transactionRunner.withTransaction(() => this.createWithinTransaction(request));
	}

	async createWithinTransaction(request: OutboxDeliveryCreateRequest): Promise<OutboxDeliveryRecord> {
		const now = clockMilliseconds(this.clock);
		const record = buildPreparedRecord(request, now);
		const existing = await this.store.findByIdempotencyKey(record.idempotencyKey);
		if (existing !== undefined) {
			if (sameCreate(existing, record)) {
				return existing;
			}
			throw new OutboxIdempotencyConflictError();
		}
		if (record.nextAttemptAt !== null && record.nextAttemptAt < now) {
			throw new OutboxValidationError();
		}
		const sameId = await this.store.findById(record.id);
		if (sameId !== undefined) {
			throw new OutboxIdConflictError();
		}
		try {
			await this.store.insert(record);
		} catch (error) {
			if (error instanceof OutboxStoreConflictError) {
				throw new OutboxIdempotencyConflictError();
			}
			throw error;
		}
		return record;
	}

	findById(id: string): Promise<OutboxDeliveryRecord | undefined> {
		assertUuid(id);
		return this.store.findById(id);
	}

	async cancel(id: string): Promise<void> {
		assertUuid(id);
		const now = clockMilliseconds(this.clock);
		await this.transactionRunner.withTransaction(async () => {
			const current = await this.requireCurrent(id);
			if (
				current.status !== "prepared" || current.attemptCount !== 0 || current.claimToken !== null ||
				current.dispatchStartedAt !== null || current.requestDeadlineAt !== null ||
				current.telegramRetryAfter !== null || current.lastErrorKind !== null ||
				((current.kind === "dm_send" || current.kind === "channel_send") && current.messageId !== null)
			) {
				throw new OutboxTransitionError();
			}
			await this.transition(() => this.store.cancel(id, now));
		});
	}

	async supersede(id: string): Promise<void> {
		assertUuid(id);
		const now = clockMilliseconds(this.clock);
		await this.transactionRunner.withTransaction(async () => {
			const current = await this.requireCurrent(id);
			if (
				current.status !== "prepared" || current.attemptCount !== 0 || current.claimToken !== null ||
				current.dispatchStartedAt !== null || current.requestDeadlineAt !== null
				|| current.telegramRetryAfter !== null || current.lastErrorKind !== null
			) {
				throw new OutboxTransitionError();
			}
			await this.transition(() => this.store.supersede(id, now));
		});
	}

	private async transition(work: () => Promise<void>): Promise<void> {
		try {
			await work();
		} catch (error) {
			if (error instanceof OutboxStoreConflictError) {
				throw new OutboxTransitionError();
			}
			throw error;
		}
	}

	private async requireCurrent(id: string): Promise<OutboxDeliveryRecord> {
		const current = await this.store.findById(id);
		if (current === undefined) {
			throw new OutboxNotFoundError();
		}
		return current;
	}

}

export interface AtomicCompanionRequest {
	readonly businessEffect: () => void | PromiseLike<void>;
	readonly delivery?: OutboxDeliveryCreateRequest;
	readonly event?: import("./product-event-service.js").ProductEventAppendRequest;
}

export class AtomicCompanionService {
	constructor(
		private readonly transactionRunner: TransactionRunner,
		private readonly outbox: OutboxDeliveryService,
		private readonly events: import("./product-event-service.js").ProductEventService,
	) {}

	async run(request: AtomicCompanionRequest): Promise<{
		readonly delivery?: OutboxDeliveryRecord;
		readonly event?: import("./product-event-service.js").ProductEventRecord;
	}> {
		return this.transactionRunner.withTransaction(async () => {
			await request.businessEffect();
			const delivery = request.delivery === undefined ? undefined : await this.outbox.createWithinTransaction(request.delivery);
			const event = request.event === undefined ? undefined : await this.events.appendWithinTransaction(request.event);
			const result: { delivery?: OutboxDeliveryRecord; event?: import("./product-event-service.js").ProductEventRecord } = {};
			if (delivery !== undefined) result.delivery = delivery;
			if (event !== undefined) result.event = event;
			return result;
		});
	}
}

function buildPreparedRecord(request: OutboxDeliveryCreateRequest, now: number): OutboxDeliveryRecord {
	assertUuid(request.id);
	assertInternalId(request.idempotencyKey);
	assertRecipientChatId(request.recipientChatId);
	if ((request.messageId !== undefined && (!Number.isSafeInteger(request.messageId) || request.messageId <= 0)) ||
		((request.kind === "dm_send" || request.kind === "channel_send") && request.messageId !== undefined) ||
		(request.kind === "channel_edit" || request.kind === "channel_delete") && request.messageId === undefined) {
		throw new OutboxValidationError();
	}
	if (request.notBeforeAt !== undefined && (!Number.isSafeInteger(request.notBeforeAt) || request.notBeforeAt < 0)) {
		throw new OutboxValidationError();
	}
	if (!OUTBOX_DELIVERY_KINDS.includes(request.kind)) {
		throw new OutboxValidationError();
	}
	let payloadJson: string;
	try {
		payloadJson = serializeDeliveryPayload(request.payload);
	} catch (error) {
		if (error instanceof DeliveryPayloadValidationError) {
			throw new OutboxValidationError();
		}
		throw error;
	}
	const method = request.payload.method;
	if (
		((request.kind === "dm_send" || request.kind === "channel_send") && method !== "send") ||
		(request.kind === "channel_edit" && method !== "edit") ||
		(request.kind === "channel_delete" && method !== "delete")
	) {
		throw new OutboxValidationError();
	}
	return {
		id: request.id,
		idempotencyKey: request.idempotencyKey,
		kind: request.kind,
		recipientChatId: request.recipientChatId,
		messageId: request.messageId ?? null,
		payload: parseDeliveryPayload(payloadJson),
		status: "prepared",
		attemptCount: 0,
		claimToken: null,
		dispatchStartedAt: null,
		requestDeadlineAt: null,
		nextAttemptAt: request.notBeforeAt ?? null,
		telegramRetryAfter: null,
		lastErrorKind: null,
		createdAt: now,
		updatedAt: now,
	};
}

function sameCreate(left: OutboxDeliveryRecord, right: OutboxDeliveryRecord): boolean {
	return left.kind === right.kind && left.recipientChatId === right.recipientChatId &&
		left.messageId === right.messageId && left.nextAttemptAt === right.nextAttemptAt &&
		serializeDeliveryPayload(left.payload) === serializeDeliveryPayload(right.payload);
}

function assertUuid(value: string): void {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
		throw new OutboxValidationError();
	}
}

function assertInternalId(value: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
		throw new OutboxValidationError();
	}
}

function assertRecipientChatId(value: string): void {
	if (!/^-?[0-9]{1,20}$/.test(value)) {
		throw new OutboxValidationError();
	}
}

function clockMilliseconds(clock: Clock): number {
	const milliseconds = clock.now().getTime();
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
		throw new OutboxValidationError();
	}
	return milliseconds;
}
