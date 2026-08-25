import { describe, expect, it } from "vitest";

import {
	validateProfileInput,
	type ProfileInput,
} from "../../src/domain/profiles/profile.js";

const valid: ProfileInput = {
	type: "blogger",
	displayName: "Alice Creator",
	description: "Ищу партнёров для полезных городских проектов.",
	topics: ["lifestyle"],
	platforms: [{ platformType: "website", url: "https://example.com/alice" }],
};

describe("S1-01 profile domain validation", () => {
	it("normalizes user-facing whitespace while keeping Telegram identity outside the profile", () => {
		const result = validateProfileInput({
			...valid,
			displayName: "  Alice Creator  ",
			description: "  Ищу партнёров для полезных городских проектов.  ",
		});

		expect(result.displayName).toBe("Alice Creator");
		expect(result.description).toContain("Ищу партнёров");
		expect(result).not.toHaveProperty("privateContact");
	});

	it("rejects invalid profile bounds and duplicate topics", () => {
		for (const input of [
			{ ...valid, displayName: "A" },
			{ ...valid, description: "коротко" },
			{ ...valid, topics: [] },
			{ ...valid, topics: ["city", "city"] },
			{ ...valid, topics: ["city", "food", "beauty", "travel"] },
			{ ...valid, platforms: [] },
		]) {
			expect(() => validateProfileInput(input as ProfileInput)).toThrow();
		}
	});

	it("rejects unsafe public URLs and audience values", () => {
		expect(() => validateProfileInput({ ...valid, platforms: [{ platformType: "website", url: "http://example.com" }] })).toThrow();
		expect(() => validateProfileInput({ ...valid, platforms: [{ platformType: "website", url: "https://user:pass@example.com" }] })).toThrow();
		expect(() => validateProfileInput({ ...valid, platforms: [{ platformType: "telegram", url: "https://t.me/+invite" }] })).toThrow();
		expect(() => validateProfileInput({ ...valid, platforms: [{ platformType: "website", url: "https://example.com", audienceSize: -1 }] })).toThrow();
	});

	it("accepts all canonical profile types and a public Telegram username URL", () => {
		for (const type of ["blogger", "telegram_channel", "venue_or_brand"] as const) {
			expect(validateProfileInput({ ...valid, type }).type).toBe(type);
		}
		expect(validateProfileInput({
			...valid,
			type: "telegram_channel",
			platforms: [{ platformType: "telegram", url: "https://t.me/collab_channel", telegramChatId: "-100123" }],
		}).platforms[0]?.telegramChatId).toBe("-100123");
	});
});
