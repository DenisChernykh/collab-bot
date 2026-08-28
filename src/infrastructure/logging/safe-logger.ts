import type { Clock } from "../../shared/application/ports/clock.js";

export const SAFE_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type SafeLogLevel = (typeof SAFE_LOG_LEVELS)[number];

export interface SafeLogFields {
	readonly correlationId?: string;
	readonly commandId?: string;
	readonly updateId?: string;
	readonly entityId?: string;
	readonly outcome?: string;
	readonly errorName?: SafeErrorName;
	readonly errorKind?: SafeErrorKind;
	readonly durationMs?: number;
}

export interface SafeLogEntry extends SafeLogFields {
	readonly timestampMs: number;
	readonly level: SafeLogLevel;
	readonly module: string;
	readonly event: string;
}

export type SafeLogSink = (entry: SafeLogEntry) => void;

export const SAFE_ERROR_NAMES = [
	"Error",
	"TypeError",
	"RangeError",
	"ConfigValidationError",
	"DomainValidationError",
	"UnknownError",
] as const;
export type SafeErrorName = (typeof SAFE_ERROR_NAMES)[number];

export const SAFE_ERROR_KINDS = ["validation", "invariant", "provider", "unknown"] as const;
export type SafeErrorKind = (typeof SAFE_ERROR_KINDS)[number];

const SAFE_FIELD_NAMES = new Set<string>([
	"correlationId",
	"commandId",
	"updateId",
	"entityId",
	"outcome",
	"errorName",
	"errorKind",
	"durationMs",
]);
const SENSITIVE_FIELD_NAME = /(token|secret|password|contact|phone|email|raw|message|text|content|description|offer|expectation)/i;
const SAFE_IDENTIFIER = /^[a-z][a-z0-9._-]{0,63}$/;
const INTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DECIMAL_ID = /^\d+$/;

export class UnsafeLogFieldError extends Error {
	constructor(fieldName: string) {
		super(`unsafe log field: ${fieldName}`);
		this.name = "UnsafeLogFieldError";
	}
}

export interface SerializedSafeError {
	readonly name: SafeErrorName;
	readonly kind: SafeErrorKind;
}

export function serializeSafeError(error: unknown): SerializedSafeError {
	if (typeof error !== "object" || error === null) {
		return { name: "UnknownError", kind: "unknown" };
	}

	const candidate = error as { readonly name?: unknown; readonly kind?: unknown };
	const errorName = isSafeErrorName(candidate.name) ? candidate.name : "UnknownError";
	const errorKind = isSafeErrorKind(candidate.kind) ? candidate.kind : "unknown";
	return { name: errorName, kind: errorKind };
}

export class SafeLogger {
	constructor(
		private readonly sink: SafeLogSink,
		private readonly clock: Clock,
		private readonly module: string,
	) {
		assertSafeIdentifier(module, "module");
	}

	debug(event: string, fields: SafeLogFields = {}): void {
		this.write("debug", event, fields);
	}

	info(event: string, fields: SafeLogFields = {}): void {
		this.write("info", event, fields);
	}

	warn(event: string, fields: SafeLogFields = {}): void {
		this.write("warn", event, fields);
	}

	error(event: string, error: unknown, fields: SafeLogFields = {}): void {
		const serialized = serializeSafeError(error);
		this.write("error", event, {
			...fields,
			errorName: serialized.name,
			errorKind: serialized.kind,
		});
	}

	private write(level: SafeLogLevel, event: string, fields: SafeLogFields): void {
		assertSafeIdentifier(event, "event");
		const safeFields = validateSafeFields(fields);
		this.sink({
			timestampMs: this.clock.now().getTime(),
			level,
			module: this.module,
			event,
			...safeFields,
		});
	}
}

function validateSafeFields(fields: SafeLogFields): SafeLogFields {
	if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
		throw new UnsafeLogFieldError("fields");
	}

	for (const fieldName of Object.keys(fields)) {
		if (!SAFE_FIELD_NAMES.has(fieldName) || SENSITIVE_FIELD_NAME.test(fieldName)) {
			throw new UnsafeLogFieldError(fieldName);
		}
		const value = fields[fieldName as keyof SafeLogFields];
		if (
			typeof value !== "string" &&
			typeof value !== "number"
		) {
			throw new UnsafeLogFieldError(fieldName);
		}
		if (fieldName === "errorName" && !isSafeErrorName(value)) {
			throw new UnsafeLogFieldError(fieldName);
		}
		if (fieldName === "errorKind" && !isSafeErrorKind(value)) {
			throw new UnsafeLogFieldError(fieldName);
		}
		if (
			(fieldName === "correlationId" || fieldName === "commandId" || fieldName === "entityId") &&
			(typeof value !== "string" || !INTERNAL_ID.test(value))
		) {
			throw new UnsafeLogFieldError(fieldName);
		}
		if (fieldName === "updateId" && (typeof value !== "string" || !DECIMAL_ID.test(value))) {
			throw new UnsafeLogFieldError(fieldName);
		}
		if (fieldName === "outcome" && (typeof value !== "string" || !SAFE_IDENTIFIER.test(value))) {
			throw new UnsafeLogFieldError(fieldName);
		}
		if (typeof value === "number" && !Number.isFinite(value)) {
			throw new UnsafeLogFieldError(fieldName);
		}
		if (fieldName === "durationMs" && (typeof value !== "number" || value < 0)) {
			throw new UnsafeLogFieldError(fieldName);
		}
	}
	return { ...fields };
}

function assertSafeIdentifier(value: string, fieldName: string): void {
	if (!SAFE_IDENTIFIER.test(value)) {
		throw new UnsafeLogFieldError(fieldName);
	}
}

function isSafeErrorName(value: unknown): value is SafeErrorName {
	return typeof value === "string" && SAFE_ERROR_NAMES.includes(value as SafeErrorName);
}

function isSafeErrorKind(value: unknown): value is SafeErrorKind {
	return typeof value === "string" && SAFE_ERROR_KINDS.includes(value as SafeErrorKind);
}
