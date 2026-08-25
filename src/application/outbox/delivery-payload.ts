export type DeliveryPayload = DeliverySendPayload | DeliveryEditPayload | DeliveryDeletePayload;

export interface DeliverySendPayload {
	readonly version: 1;
	readonly method: "send";
	readonly text: string;
}

export interface DeliveryEditPayload {
	readonly version: 1;
	readonly method: "edit";
	readonly text: string;
}

export interface DeliveryDeletePayload {
	readonly version: 1;
	readonly method: "delete";
}

export class DeliveryPayloadValidationError extends Error {
	constructor() {
		super("delivery payload is not a safe versioned payload");
		this.name = "DeliveryPayloadValidationError";
	}
}

const MAX_TEXT_LENGTH = 4096;

export function serializeDeliveryPayload(value: unknown): string {
	return JSON.stringify(toDeliveryPayloadSnapshot(value));
}

export function parseDeliveryPayload(serialized: string): DeliveryPayload {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new DeliveryPayloadValidationError();
	}
	return toDeliveryPayloadSnapshot(value);
}

function toDeliveryPayloadSnapshot(value: unknown): DeliveryPayload {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new DeliveryPayloadValidationError();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new DeliveryPayloadValidationError();
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !["version", "method", "text"].includes(key)) {
			throw new DeliveryPayloadValidationError();
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new DeliveryPayloadValidationError();
		}
	}
	const version = ownDataValue(value, "version");
	const method = ownDataValue(value, "method");
	const text = ownDataValue(value, "text");
	if (version !== 1 || (method !== "send" && method !== "edit" && method !== "delete")) {
		throw new DeliveryPayloadValidationError();
	}
	if (method === "delete") {
		if (text !== undefined || ownDataValue(value, "text") !== undefined || Reflect.ownKeys(value).length !== 2) {
			throw new DeliveryPayloadValidationError();
		}
		const snapshot = Object.create(null) as Record<string, unknown>;
		snapshot.version = 1;
		snapshot.method = "delete";
		return snapshot as unknown as DeliveryDeletePayload;
	}
	if (typeof text !== "string" || text.length === 0 || text.length > MAX_TEXT_LENGTH) {
		throw new DeliveryPayloadValidationError();
	}
	if (Reflect.ownKeys(value).length !== 3) {
		throw new DeliveryPayloadValidationError();
	}
	const snapshot = Object.create(null) as Record<string, unknown>;
	snapshot.version = 1;
	snapshot.method = method;
	snapshot.text = text;
	return snapshot as unknown as DeliverySendPayload | DeliveryEditPayload;
}

function ownDataValue(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor === undefined) {
		return undefined;
	}
	if (!("value" in descriptor)) {
		throw new DeliveryPayloadValidationError();
	}
	return descriptor.value;
}
