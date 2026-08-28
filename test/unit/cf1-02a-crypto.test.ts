import { describe, expect, it } from "vitest";

import {
	base64UrlEncode,
	createCryptoCapabilities,
} from "../../src/platform/crypto/capabilities.js";
import {
	generateCallbackToken,
	generatePublicToken,
	generateUuid,
	hashOpaqueToken,
} from "../../src/platform/crypto/tokens.js";

describe("CF1 portable crypto primitives", () => {
	it("keeps SHA-256 golden values compatible with the Node implementation", () => {
		expect(hashOpaqueToken("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(hashOpaqueToken("Collaboration Bot")).toBe("9edf97bc32c14da7b8f0a91cfa7017733271f8f287475b492e220a3cfa78bcb6");
	});

	it("uses only the required UUID and opaque-token formats", () => {
		expect(generateUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
		for (const token of [generatePublicToken(), generateCallbackToken()]) {
			expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/u);
			expect(token).not.toContain("=");
		}
	});

	it("supports deterministic injected randomness without weakening the default", () => {
		const injected = createCryptoCapabilities({
			randomUUID: () => "00000000-0000-4000-8000-000000000000",
			getRandomValues: <T extends Uint8Array>(array: T): T => {
				new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0xab);
				return array;
			},
		});

		expect(injected.uuid()).toBe("00000000-0000-4000-8000-000000000000");
		expect(base64UrlEncode(injected.randomBytes(16))).toBe("q6urq6urq6urq6urq6urqw");
		expect(injected.hashUtf8("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
		expect(() => injected.randomBytes(0)).toThrow("random byte length");
		expect(() => injected.randomBytes(65_537)).toThrow("random byte length");
	});
});
