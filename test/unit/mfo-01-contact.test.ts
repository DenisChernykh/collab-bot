import { expect, it } from "vitest";
import { validateMfmContact } from "../../src/modules/profiles/domain/mfm-profile.js";

it.each([
	{ kind: "telegram_user" },
	{ kind: "telegram_channel", url: "https://t.me/public_channel", username: "public_channel", telegramChatId: "-100123", title: "Public channel" },
	{ kind: "telegram_group", url: "https://t.me/public_group", username: "public_group", telegramChatId: "-456", title: "Public group" },
	{ kind: "external", url: "https://example.com/contact" },
])("accepts a supported private preferred contact %j", (contact) => {
	expect(validateMfmContact(contact)).toEqual(contact);
});

it.each([
	{ kind: "anything", url: "https://example.com" },
	{ kind: "external", url: "http://example.com" },
	{ kind: "external", url: "https://user:secret@example.com" },
	{ kind: "telegram_channel", url: "https://example.com/channel", username: "channel", telegramChatId: "-1" },
	{ kind: "telegram_group", url: "https://t.me/private", username: "bad-name", telegramChatId: "-1" },
	{ kind: "telegram_group", url: "https://t.me/public_group", username: "public_group", telegramChatId: "1" },
	{ kind: "telegram_user", url: "https://t.me/unexpected" },
])("rejects an unsafe or incoherent preferred contact %j", (contact) => {
	expect(() => validateMfmContact(contact)).toThrow();
});
