export type DeliveryPayload = DeliverySendPayload | DeliveryEditPayload | DeliveryDeletePayload;

export interface DeliverySendPayload {
	readonly version: 1;
	readonly method: "send";
	readonly text: string;
	readonly replyMarkup?: DeliveryInlineKeyboard;
}

export interface DeliveryEditPayload {
	readonly version: 1;
	readonly method: "edit";
	readonly text: string;
	readonly replyMarkup?: DeliveryInlineKeyboard;
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

export interface DeliveryInlineKeyboard {
	readonly inline_keyboard: readonly (readonly [{ readonly text: string; readonly url: string }])[];
}

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
		if (typeof key !== "string" || !["version", "method", "text", "replyMarkup"].includes(key)) {
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
	const replyMarkup = ownDataValue(value, "replyMarkup");
	if (replyMarkup !== undefined && !isSafeInlineKeyboard(replyMarkup, method)) {
		throw new DeliveryPayloadValidationError();
	}
	const snapshot = Object.create(null) as Record<string, unknown>;
	snapshot.version = 1;
	snapshot.method = method;
	snapshot.text = text;
	if (replyMarkup !== undefined) snapshot.replyMarkup = cloneInlineKeyboard(replyMarkup as DeliveryInlineKeyboard);
	return snapshot as unknown as DeliverySendPayload | DeliveryEditPayload;
}

function isSafeInlineKeyboard(value: unknown, method: "send" | "edit"): value is DeliveryInlineKeyboard {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const valueKeys = Reflect.ownKeys(value);
	if (valueKeys.length !== 1 || valueKeys[0] !== "inline_keyboard") return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, "inline_keyboard");
	if (descriptor === undefined || !("value" in descriptor)) return false;
	const keyboard = (value as { inline_keyboard?: unknown }).inline_keyboard;
	if (!Array.isArray(keyboard)) return false;
	if (method === "edit" && keyboard.length === 0) return true;
	if (keyboard.length !== 1 || !Array.isArray(keyboard[0]) || keyboard[0].length !== 1) return false;
	const button = keyboard[0][0];
	if (typeof button !== "object" || button === null || Array.isArray(button)) return false;
	const buttonPrototype = Object.getPrototypeOf(button);
	if (buttonPrototype !== Object.prototype && buttonPrototype !== null) return false;
	const keys = Reflect.ownKeys(button);
	if (keys.some((key) => typeof key !== "string" || !["text", "url"].includes(key)) || keys.length !== 2) return false;
	const text = ownDataValue(button, "text");
	const url = ownDataValue(button, "url");
	return typeof text === "string" && text.length > 0 && text.length <= 128 && typeof url === "string" && isAllowedTelegramUrl(url);
}

function isAllowedTelegramUrl(value: string): boolean {
	return /^https:\/\/t\.me\/[A-Za-z0-9_]{1,64}\?start=c_[A-Za-z0-9_-]{22}$/.test(value) ||
		/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}$/.test(value) ||
		/^tg:\/\/user\?id=[1-9][0-9]{0,19}$/.test(value);
}

function cloneInlineKeyboard(value: DeliveryInlineKeyboard): DeliveryInlineKeyboard {
	const button = value.inline_keyboard[0]?.[0];
	return button === undefined ? { inline_keyboard: [] } : { inline_keyboard: [[{ text: button.text, url: button.url }]] };
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
