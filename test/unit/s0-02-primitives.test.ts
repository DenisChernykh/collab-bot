import { describe, expect, it } from "vitest";

import {
	COLLABORATION_FORMATS,
	COLLABORATION_STATUSES,
	COMPLETION_RESULTS,
	APPLICATION_STATUSES,
	PLATFORM_TYPES,
	PROFILE_TYPES,
	TARGET_PROFILE_TYPES,
	TOPICS,
	parseApplicationStatus,
	parseCollaborationFormat,
	parseCollaborationStatus,
	parseCompletionResult,
	parsePlatformType,
	parseProfileType,
	parseTargetProfileType,
	parseTopic,
} from "../../src/domain/value-objects/enums.js";
import { type Clock } from "../../src/application/ports/clock.js";
import { FakeClock } from "../../src/infrastructure/time/fake-clock.js";
import {
	deadlineAtEndOfLocalDay,
	formatEventDate,
	isDeadlineDue,
	isMutationAllowed,
	parseLocalDate,
} from "../../src/modules/collaborations/domain/deadline.js";
import {
	generateCallbackToken,
	generatePublicToken,
	generateUuid,
	hashOpaqueToken,
} from "../../src/infrastructure/crypto/tokens.js";
import {
	SafeLogger,
	serializeSafeError,
	type SafeLogEntry,
	type SafeLogFields,
} from "../../src/infrastructure/logging/safe-logger.js";

describe("canonical enums", () => {
	it("accepts every PRD value and rejects aliases or unknown values", () => {
		const enumCases = [
			[PROFILE_TYPES, parseProfileType],
			[COLLABORATION_FORMATS, parseCollaborationFormat],
			[TARGET_PROFILE_TYPES, parseTargetProfileType],
			[TOPICS, parseTopic],
			[PLATFORM_TYPES, parsePlatformType],
			[COLLABORATION_STATUSES, parseCollaborationStatus],
			[APPLICATION_STATUSES, parseApplicationStatus],
			[COMPLETION_RESULTS, parseCompletionResult],
		] as const;

		for (const [values, parse] of enumCases) {
			for (const value of values) {
				expect(parse(value)).toBe(value);
			}
			expect(() => parse("unknown" as never)).toThrow();
			expect(() => parse("blogger_alias" as never)).toThrow();
		}
	});
});

describe("inclusive deadline", () => {
	it("parses the local date strictly and converts the end of day to UTC", () => {
		const date = parseLocalDate("15.01.2026");

		expect(date).toEqual({ year: 2026, month: 1, day: 15 });
		expect(formatEventDate(date)).toBe("2026-01-15");
		expect(deadlineAtEndOfLocalDay(date)).toBe(
			Date.parse("2026-01-15T18:59:59.999Z"),
		);
	});

	it("rejects rollover and non-canonical dates", () => {
		for (const value of ["31.02.2026", "29.02.2026", "01.1.2026", "1.01.2026", "15/01/2026"]) {
			expect(() => parseLocalDate(value)).toThrow();
		}
		expect(parseLocalDate("29.02.2028")).toEqual({ year: 2028, month: 2, day: 29 });
	});

	it("rejects invalid components supplied through the public LocalDate shape", () => {
		const invalidDate = { year: 2026, month: 2, day: 30 };

		expect(() => formatEventDate(invalidDate)).toThrow();
		expect(() => deadlineAtEndOfLocalDay(invalidDate)).toThrow();
	});

	it("allows mutation at the deadline and marks work due only after it", () => {
		const deadline = Date.parse("2026-01-15T18:59:59.999Z");

		expect(isMutationAllowed(deadline, deadline)).toBe(true);
		expect(isMutationAllowed(deadline - 1, deadline)).toBe(true);
		expect(isMutationAllowed(deadline + 1, deadline)).toBe(false);
		expect(isDeadlineDue(deadline, deadline)).toBe(false);
		expect(isDeadlineDue(deadline + 1, deadline)).toBe(true);
	});
});

describe("fake clock", () => {
	it("returns deterministic defensive Date copies", () => {
		const source = new Date("2026-01-15T00:00:00.000Z");
		const clock: Clock = new FakeClock(source);
		source.setUTCFullYear(2030);

		const first = clock.now();
		first.setUTCFullYear(2040);

		expect(clock.now().toISOString()).toBe("2026-01-15T00:00:00.000Z");
	});

	it("rejects a non-finite result without changing state", () => {
		const clock = new FakeClock(Number.MAX_VALUE);

		expect(() => clock.advanceBy(Number.MAX_VALUE)).toThrow();
		clock.advanceBy(-Number.MAX_VALUE);
		expect(clock.now().getTime()).toBe(0);
	});
});

describe("opaque token", () => {
	it("uses UUIDs and 128-bit unpadded base64url tokens", () => {
		expect(generateUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

		const tokens = Array.from({ length: 8 }, (_, index) =>
			index % 2 === 0 ? generatePublicToken() : generateCallbackToken(),
		);
		expect(new Set(tokens).size).toBe(tokens.length);
		for (const token of tokens) {
			expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(token).not.toContain("=");
			expect(Buffer.from(token, "base64url")).toHaveLength(16);
		}
	});

	it("hashes the exact token deterministically", () => {
		const token = generateCallbackToken();

		expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
		expect(hashOpaqueToken(token)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashOpaqueToken(`${token}x`)).not.toBe(hashOpaqueToken(token));
	});
});

describe("logger redaction", () => {
	it("emits only typed safe fields and rejects sensitive or nested data", () => {
		const entries: SafeLogEntry[] = [];
		const logger = new SafeLogger((entry) => entries.push(entry), new FakeClock(0), "unit");

		logger.info("primitive.accepted", {
			correlationId: "550e8400-e29b-41d4-a716-446655440000",
			commandId: "command-1",
			entityId: "profile-1",
			updateId: "123456",
			outcome: "ok",
			durationMs: 0,
		});
		expect(entries[0]).toMatchObject({ event: "primitive.accepted", entityId: "profile-1", outcome: "ok" });
		expect(() => new SafeLogger(() => undefined, new FakeClock(0), "module with spaces")).toThrow();
		expect(() => logger.info("unsafe.token", { token: "opaque" } as unknown as SafeLogFields)).toThrow();
		expect(() => logger.info("unsafe.contact", { contact: "person@example.test" } as unknown as SafeLogFields)).toThrow();
		expect(() => logger.info("unsafe.nested", { entityId: "id", details: { value: "raw" } } as unknown as SafeLogFields)).toThrow();
		expect(() => logger.info("unsafe.value", { outcome: "secret raw message" })).toThrow();
		expect(() => logger.info("unsafe.id", { entityId: "person@example.com" })).toThrow();
		expect(() => logger.info("unsafe.update", { updateId: "12.3" })).toThrow();
		expect(() => logger.info("unsafe.duration", { durationMs: -1 })).toThrow();
	});

	it("serializes errors to allowlisted name and kind only", () => {
		const error = Object.assign(new Error("secret raw message"), {
			name: "ConfigValidationError",
			kind: "validation",
		});

		expect(serializeSafeError(error)).toEqual({ name: "ConfigValidationError", kind: "validation" });
		expect(serializeSafeError(error)).not.toHaveProperty("message");

		const entries: SafeLogEntry[] = [];
		const logger = new SafeLogger((entry) => entries.push(entry), new FakeClock(0), "unit");
		logger.error("primitive.failure", error);
		expect(entries[0]).toMatchObject({ errorName: "ConfigValidationError", errorKind: "validation" });
		expect(entries[0]).not.toHaveProperty("message");
	});
});
