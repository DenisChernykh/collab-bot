import type { Clock } from "../../shared/application/ports/clock.js";
import type { ProductEventStore } from "../ports/product-event-store.js";
import {
	ProductEventStoreConflictError,
	ProductEventStoreIdConflictError,
} from "../ports/product-event-store.js";
import type { TransactionRunner } from "../../shared/application/ports/transaction-runner.js";
import {
	PRODUCT_EVENT_TYPES,
	type ProductEventAppendRequest,
	type ProductEventRecord,
	type ProductEventType,
	type SafeAttributes,
} from "./product-event-contracts.js";

export { PRODUCT_EVENT_TYPES } from "./product-event-contracts.js";
export type {
	ProductEventAppendRequest,
	ProductEventRecord,
	ProductEventType,
	SafeAttributes,
} from "./product-event-contracts.js";

type AttributeRule = "boolean" | "number" | readonly string[];
export const PRODUCT_EVENT_ATTRIBUTE_POLICY: Readonly<Record<ProductEventType, Readonly<Record<string, AttributeRule>>>> = {
	bot_started: { count: "number", enabled: "boolean" },
	profile_started: { count: "number", enabled: "boolean" },
	profile_completed: { count: "number", enabled: "boolean" },
	collaboration_draft_started: { count: "number", enabled: "boolean" },
	collaboration_published: { count: "number", enabled: "boolean" },
	collaboration_viewed: { count: "number", enabled: "boolean" },
	application_submitted: { count: "number", enabled: "boolean" },
	application_accepted: { count: "number", enabled: "boolean" },
	collaboration_matched: { count: "number", enabled: "boolean" },
	completion_reported: { count: "number", enabled: "boolean" },
	collaboration_bilateral_confirmed: { count: "number", enabled: "boolean" },
	collaboration_hidden: { count: "number", enabled: "boolean" },
	user_blocked: { count: "number", enabled: "boolean" },
};

const validatedAttributes = new WeakSet<object>();
const attributesEventTypes = new WeakMap<object, ProductEventType>();

export function createSafeAttributes(eventType: ProductEventType, value: unknown): SafeAttributes {
	if (!PRODUCT_EVENT_TYPES.includes(eventType) || typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ProductEventValidationError();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new ProductEventValidationError();
	}
	const policy = PRODUCT_EVENT_ATTRIBUTE_POLICY[eventType];
	const snapshot = Object.create(null) as Record<string, boolean | number | string>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(policy, key)) {
			throw new ProductEventValidationError();
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new ProductEventValidationError();
		}
		const attributeValue = descriptor.value;
		const rule = policy[key];
		if (rule === undefined) {
			throw new ProductEventValidationError();
		}
		if (rule === "boolean") {
			if (typeof attributeValue !== "boolean") {
				throw new ProductEventValidationError();
			}
		} else if (rule === "number") {
			if (!Number.isSafeInteger(attributeValue) || attributeValue < 0) {
				throw new ProductEventValidationError();
			}
		} else if (typeof attributeValue !== "string" || !rule.includes(attributeValue)) {
			throw new ProductEventValidationError();
		}
		snapshot[key] = attributeValue;
	}
	Object.freeze(snapshot);
	validatedAttributes.add(snapshot);
	attributesEventTypes.set(snapshot, eventType);
	return snapshot as SafeAttributes;
}

export function serializeSafeAttributes(value: SafeAttributes, eventType: ProductEventType): string {
	if (!validatedAttributes.has(value as object) || attributesEventTypes.get(value as object) !== eventType) {
		throw new ProductEventValidationError();
	}
	const snapshot = Object.create(null) as Record<string, boolean | number | string>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") {
			throw new ProductEventValidationError();
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new ProductEventValidationError();
		}
		snapshot[key] = descriptor.value as boolean | number | string;
	}
	return JSON.stringify(snapshot);
}

export function parseSafeAttributes(serialized: string, eventType: ProductEventType): SafeAttributes {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new ProductEventValidationError();
	}
	return createSafeAttributes(eventType, value);
}

export class ProductEventValidationError extends Error {
	constructor() {
		super("product event is invalid");
		this.name = "ProductEventValidationError";
	}
}

export class ProductEventNotFoundError extends Error {
	constructor() {
		super("product event was not found");
		this.name = "ProductEventNotFoundError";
	}
}

export class ProductEventIdempotencyConflictError extends Error {
	constructor() {
		super("product event idempotency key conflicts with an existing event");
		this.name = "ProductEventIdempotencyConflictError";
	}
}

export class ProductEventIdConflictError extends Error {
	constructor() {
		super("product event ID already exists");
		this.name = "ProductEventIdConflictError";
	}
}

export class ProductEventService {
	constructor(
		private readonly store: ProductEventStore,
		private readonly transactionRunner: TransactionRunner,
		private readonly clock: Clock,
	) {}

	append(request: ProductEventAppendRequest): Promise<ProductEventRecord> {
		return this.transactionRunner.withTransaction(() => this.appendWithinTransaction(request));
	}

	async appendWithinTransaction(request: ProductEventAppendRequest): Promise<ProductEventRecord> {
		const record = buildRecord(request, this.clock);
		const existing = await this.store.findByIdempotencyKey(record.idempotencyKey);
		if (existing !== undefined) {
			if (sameEvent(existing, record)) {
				return existing;
			}
			throw new ProductEventIdempotencyConflictError();
		}
		try {
			await this.store.append(record);
		} catch (error) {
			if (error instanceof ProductEventStoreIdConflictError) {
				throw new ProductEventIdConflictError();
			}
			if (error instanceof ProductEventStoreConflictError) {
				throw new ProductEventIdempotencyConflictError();
			}
			throw error;
		}
		return record;
	}
}

function buildRecord(request: ProductEventAppendRequest, clock: Clock): ProductEventRecord {
	assertUuid(request.eventId);
	assertInternalId(request.idempotencyKey);
	if (!PRODUCT_EVENT_TYPES.includes(request.eventType)) {
		throw new ProductEventValidationError();
	}
	for (const value of [request.actorTelegramUserId, request.profileId, request.collaborationId, request.applicationId]) {
		if (value !== undefined) assertInternalId(value);
	}
	if (request.actorTelegramUserId !== undefined && !/^[0-9]{1,20}$/.test(request.actorTelegramUserId)) {
		throw new ProductEventValidationError();
	}
	const occurredAt = request.occurredAt ?? clock.now().getTime();
	if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
		throw new ProductEventValidationError();
	}
	const safeAttributesJson = serializeSafeAttributes(request.safeAttributes, request.eventType);
	return {
		eventId: request.eventId,
		eventType: request.eventType,
		idempotencyKey: request.idempotencyKey,
		actorTelegramUserId: request.actorTelegramUserId ?? null,
		profileId: request.profileId ?? null,
		collaborationId: request.collaborationId ?? null,
		applicationId: request.applicationId ?? null,
		safeAttributes: parseSafeAttributes(safeAttributesJson, request.eventType),
		occurredAt,
	};
}

function sameEvent(left: ProductEventRecord, right: ProductEventRecord): boolean {
	return left.eventType === right.eventType &&
		left.actorTelegramUserId === right.actorTelegramUserId && left.profileId === right.profileId &&
		left.collaborationId === right.collaborationId && left.applicationId === right.applicationId &&
		serializeSafeAttributes(left.safeAttributes, left.eventType) === serializeSafeAttributes(right.safeAttributes, right.eventType);
}

function assertUuid(value: string): void {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
		throw new ProductEventValidationError();
	}
}

function assertInternalId(value: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
		throw new ProductEventValidationError();
	}
}
