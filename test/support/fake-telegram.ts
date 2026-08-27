import type { UserFromGetMe, Update } from "grammy/types";

import {
	FakeTelegramApi,
	type FakeTelegramApiOptions,
} from "./fake-telegram-api.js";

export const FAKE_BOT_TOKEN = "fake-token";
export const FAKE_BOT_INFO = {
	id: 777,
	is_bot: true,
	first_name: "Collab",
	username: "collab_bot",
} as unknown as UserFromGetMe;

export function createFakeTelegramApi(
	options: Partial<Omit<FakeTelegramApiOptions, "token" | "botInfo">> = {},
): FakeTelegramApi {
	return new FakeTelegramApi({
		token: FAKE_BOT_TOKEN,
		botInfo: FAKE_BOT_INFO,
		...options,
	});
}

export function privateMessageForUser(
	messageId: number,
	userId: number,
	text?: string,
	username?: string,
	firstName = `User ${userId}`,
): NonNullable<Update["message"]> {
	return {
		message_id: messageId,
		date: 1_700_000_000,
		chat: { id: userId, type: "private" },
		from: {
			id: userId,
			is_bot: false,
			first_name: firstName,
			...(username === undefined ? {} : { username }),
		},
		...(text === undefined ? {} : { text }),
	} as NonNullable<Update["message"]>;
}

export function callbackForUser(
	id: number,
	userId: number,
	data: string,
	username?: string,
	firstName = `User ${userId}`,
): NonNullable<Update["callback_query"]> {
	return {
		id: `callback-${id}`,
		from: {
			id: userId,
			is_bot: false,
			first_name: firstName,
			...(username === undefined ? {} : { username }),
		},
		message: { ...privateMessageForUser(id, userId, undefined, username, firstName) },
		chat_instance: "instance",
		data,
	} as NonNullable<Update["callback_query"]>;
}

export function callbackValues(fake: FakeTelegramApi): string[] {
	return fake.lastMessage()?.reply_markup?.inline_keyboard?.flat().flatMap((button) => {
		const value = (button as { callback_data?: unknown }).callback_data;
		return typeof value === "string" ? [value] : [];
	}) ?? [];
}

export function callbackData(fake: FakeTelegramApi, prefix: string): string {
	const value = callbackValues(fake).find((candidate) => candidate.startsWith(prefix));
	if (value === undefined) throw new Error(`callback ${prefix} was not rendered`);
	return value;
}
