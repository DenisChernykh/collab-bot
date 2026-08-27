import { describe, expect, it } from "vitest";

import {
	normalizeApplicationMessage,
	renderApplicationAuthorDm,
} from "../../src/application/applications/application-service.js";

const PUBLIC_TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";

describe("S3-03 application message", () => {
	it("normalizes a 10-500 character message and rejects unsafe bounds", () => {
		expect(normalizeApplicationMessage("  0123456789  ")).toEqual({ ok: true, value: "0123456789" });
		expect(normalizeApplicationMessage("x".repeat(500))).toEqual({ ok: true, value: "x".repeat(500) });
		for (const value of ["123456789", "x".repeat(501), "valid text\u0000"]) {
			expect(normalizeApplicationMessage(value)).toEqual({ ok: false, code: "invalid_message" });
		}
	});
});

describe("S3-03 author notification privacy", () => {
	it("renders only the public profile, application message, and collaboration management link", () => {
		const payload = renderApplicationAuthorDm({
			collaborationTitle: "Городской видеопроект",
			applicationMessage: "Готов снять короткий ролик и согласовать сценарий.",
			applicant: {
				type: "blogger",
				displayName: "Публичное имя",
				description: "Пишу о городской жизни и локальных проектах.",
				topics: ["city", "lifestyle"],
				platform: {
					platformType: "telegram",
					url: "https://t.me/public_channel",
					title: "Публичный канал",
					audienceSize: 12_000,
				},
				// Deliberately model an over-wide runtime object: the renderer must copy an allowlist,
				// never stringify the complete applicant snapshot.
				telegramUserId: "200987654321",
				username: "private_handle",
				telegramChatId: "-100987654321",
				profileId: "22222222-2222-4222-8222-222222222222",
				createdAt: 1_700_000_000_000,
			} as never,
			managementUrl: `https://t.me/collab_bot?start=c_${PUBLIC_TOKEN}`,
		});

		expect(payload).toMatchObject({
			version: 1,
			method: "send",
			replyMarkup: {
				inline_keyboard: [[{
					url: `https://t.me/collab_bot?start=c_${PUBLIC_TOKEN}`,
				}]],
			},
		});
		if (payload.method !== "send") throw new Error("expected a DM send payload");
		for (const publicValue of [
			"Городской видеопроект",
			"Готов снять короткий ролик",
			"Публичное имя",
			"Пишу о городской жизни",
			"https://t.me/public_channel",
		]) expect(payload.text).toContain(publicValue);
		for (const privateValue of [
			"200987654321",
			"private_handle",
			"-100987654321",
			"22222222-2222-4222-8222-222222222222",
			"1700000000000",
		]) expect(payload.text).not.toContain(privateValue);
	});

	it("omits absent enrichment fields instead of leaking null-like placeholders", () => {
		const payload = renderApplicationAuthorDm({
			collaborationTitle: "Минимальный профиль",
			applicationMessage: "Предлагаю обсудить совместный материал в ближайшие дни.",
			applicant: {
				type: "blogger",
				displayName: "Минимальный автор",
				description: null,
				topics: [],
				platform: {
					platformType: "website",
					url: "https://example.com/public",
					title: null,
					audienceSize: null,
				},
			},
			managementUrl: `https://t.me/collab_bot?start=c_${PUBLIC_TOKEN}`,
		});

		if (payload.method !== "send") throw new Error("expected a DM send payload");
		expect(payload.text).toContain("Минимальный автор");
		expect(payload.text).toContain("https://example.com/public");
		expect(payload.text).not.toMatch(/\b(?:null|undefined)\b/i);
	});
});
