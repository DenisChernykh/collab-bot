export const SAFE_RESULT_OUTCOMES = [
	"ok",
	"completed",
	"blocked",
	"unavailable",
	"stale",
	"expired",
	"consumed",
	"conflict",
] as const;
export type SafeResultOutcome = (typeof SAFE_RESULT_OUTCOMES)[number];

export const SAFE_RESULT_MESSAGE_KEYS = [
	"command_completed",
	"command_replayed",
	"actor_blocked",
	"actor_unavailable",
	"callback_unavailable",
	"callback_stale",
	"callback_expired",
	"callback_consumed",
	"collaboration_already_hidden",
	"collaboration_unavailable",
] as const;
export type SafeResultMessageKey = (typeof SAFE_RESULT_MESSAGE_KEYS)[number];

export interface SafeResult {
	readonly version: 1;
	readonly outcome: SafeResultOutcome;
	readonly messageKey?: SafeResultMessageKey;
	readonly entityId?: string;
	readonly referenceId?: string;
}

export class SafeResultValidationError extends Error {
	constructor() {
		super("stored result is not a safe versioned result");
		this.name = "SafeResultValidationError";
	}
}

const INTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_KEYS = new Set(["version", "outcome", "messageKey", "entityId", "referenceId"]);

export function serializeSafeResult(result: SafeResult): string {
	return JSON.stringify(toSafeResultSnapshot(result));
}

export function parseSafeResult(serialized: string): SafeResult {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new SafeResultValidationError();
	}
	return toSafeResultSnapshot(value);
}

function assertSafeResult(value: unknown): asserts value is SafeResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new SafeResultValidationError();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new SafeResultValidationError();
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !SAFE_KEYS.has(key)) {
			throw new SafeResultValidationError();
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new SafeResultValidationError();
		}
	}
	const version = ownDataValue(value, "version");
	const outcome = ownDataValue(value, "outcome");
	if (
		version !== 1 ||
		typeof outcome !== "string" ||
		!SAFE_RESULT_OUTCOMES.includes(outcome as SafeResultOutcome)
	) {
		throw new SafeResultValidationError();
	}
	const messageKey = ownDataValue(value, "messageKey");
	if (
		messageKey !== undefined &&
		(typeof messageKey !== "string" || !SAFE_RESULT_MESSAGE_KEYS.includes(messageKey as SafeResultMessageKey))
	) {
		throw new SafeResultValidationError();
	}
	for (const key of ["entityId", "referenceId"] as const) {
		const valueForKey = ownDataValue(value, key);
		if (valueForKey !== undefined && (typeof valueForKey !== "string" || !INTERNAL_ID.test(valueForKey))) {
			throw new SafeResultValidationError();
		}
	}
}

function toSafeResultSnapshot(value: unknown): SafeResult {
	assertSafeResult(value);
	const snapshot = Object.create(null) as Record<string, unknown>;
	snapshot.version = 1;
	snapshot.outcome = ownDataValue(value, "outcome");
	const messageKey = ownDataValue(value, "messageKey");
	if (messageKey !== undefined) {
		snapshot.messageKey = messageKey;
	}
	const entityId = ownDataValue(value, "entityId");
	if (entityId !== undefined) {
		snapshot.entityId = entityId;
	}
	const referenceId = ownDataValue(value, "referenceId");
	if (referenceId !== undefined) {
		snapshot.referenceId = referenceId;
	}
	return snapshot as unknown as SafeResult;
}

function ownDataValue(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor === undefined) {
		return undefined;
	}
	if (!("value" in descriptor)) {
		throw new SafeResultValidationError();
	}
	return descriptor.value;
}
