import { describe, expect, it } from "vitest";

import type { CommandActor, CommandContext } from "../../src/shared/application/commands/command-contracts.js";
import {
	canonicalizeInput,
	type CanonicalInput,
} from "../../src/shared/application/commands/canonical-input.js";
import {
	parseSafeResult,
	serializeSafeResult,
	type SafeResult,
} from "../../src/shared/application/commands/safe-result.js";
import { hashCanonicalInput } from "../../src/infrastructure/crypto/canonical-input-hash.js";

describe("S0-04 pure contracts", () => {
	it("keeps command context actor-tagged and runner identities explicit", () => {
		const actor: CommandActor = { kind: "telegram_user", telegramUserId: "100" };
		const context: CommandContext = {
			commandId: "command-1",
			actor,
			occurredAt: new Date(0),
		};
		const runner: CommandActor = { kind: "runner", runner: "cleanup" };

		expect(context.actor).toEqual(actor);
		expect(runner).toEqual({ kind: "runner", runner: "cleanup" });
	});

	it("hashes canonical input independent of object key order", () => {
		const first = { actor: "100", input: { b: 2, a: 1 } } satisfies CanonicalInput;
		const second = { input: { a: 1, b: 2 }, actor: "100" } satisfies CanonicalInput;

		expect(canonicalizeInput(first)).toBe('{"actor":"100","input":{"a":1,"b":2}}');
		expect(hashCanonicalInput(first)).toBe(hashCanonicalInput(second));
		expect(hashCanonicalInput({ values: [1, 2] })).not.toBe(hashCanonicalInput({ values: [2, 1] }));
		expect(() => canonicalizeInput({ unsupported: undefined })).toThrow();
	});

	it("serializes and fail-closed validates only versioned safe results", () => {
		const result: SafeResult = {
			version: 1,
			outcome: "completed",
			messageKey: "command_completed",
			entityId: "collaboration-1",
		};
		const serialized = serializeSafeResult(result);

		expect(parseSafeResult(serialized)).toEqual(result);
		expect(() => parseSafeResult('{"version":2,"outcome":"completed"}')).toThrow();
		expect(() => parseSafeResult('{"version":1,"outcome":"completed","token":"secret"}')).toThrow();
		expect(() => parseSafeResult('{"version":1,"outcome":"completed","messageKey":"secret"}')).toThrow();
		expect(() => parseSafeResult('{"version":1,"outcome":"completed","messageKey":"raw message"}')).toThrow();
	});

	it("rejects serializer traps and never persists caller-owned keys", () => {
		const valid = {
			version: 1 as const,
			outcome: "completed" as const,
			messageKey: "command_completed" as const,
		};
		const withToJson = {
			...valid,
			toJSON: () => ({ token: "secret" }),
		};
		const withGetter = { ...valid } as Record<string, unknown>;
		Object.defineProperty(withGetter, "messageKey", {
			configurable: true,
			enumerable: true,
			get: () => "command_completed",
		});
		const secretSymbol = Symbol("secret");
		const withSymbol = { ...valid } as Record<string | symbol, unknown>;
		Object.defineProperty(withSymbol, secretSymbol, { enumerable: true, value: "raw" });
		const customPrototype = Object.create({ toJSON: () => ({ token: "secret" }) });
		Object.assign(customPrototype, valid);

		expect(() => serializeSafeResult(withToJson as SafeResult)).toThrow();
		expect(() => serializeSafeResult(withGetter as unknown as SafeResult)).toThrow();
		expect(() => serializeSafeResult(withSymbol as unknown as SafeResult)).toThrow();
		expect(() => serializeSafeResult(customPrototype as SafeResult)).toThrow();
	});
});
