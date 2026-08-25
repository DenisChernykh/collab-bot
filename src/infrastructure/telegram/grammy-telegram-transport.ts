import type { Bot } from "grammy";
import type { TelegramTransport, TelegramTransportRequest, TelegramTransportResponse } from "../../application/ports/telegram-transport.js";
import { TelegramTransportError } from "../../application/ports/telegram-transport.js";

export class GrammyTelegramTransport implements TelegramTransport {
	constructor(private readonly bot: Bot) {}

	async execute(request: TelegramTransportRequest): Promise<TelegramTransportResponse> {
		try {
			if (request.method === "send") {
				const result = await this.bot.api.sendMessage(request.chatId, request.text, request.replyMarkup === undefined ? undefined : { reply_markup: request.replyMarkup as never }, request.signal as never);
				return { method: "send", messageId: result.message_id };
			}
			if (request.method === "edit") {
				await this.bot.api.editMessageText(request.chatId, request.messageId, request.text, request.replyMarkup === undefined ? undefined : { reply_markup: request.replyMarkup as never }, request.signal as never);
				return { method: "edit" };
			}
			await this.bot.api.deleteMessage(request.chatId, request.messageId, request.signal as never);
			return { method: "delete" };
		} catch (error) {
			throw classify(error);
		}
	}
}

function classify(error: unknown): TelegramTransportError {
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	if (message.includes("too many requests") || message.includes("retry after")) return new TelegramTransportError({ code: "rate_limited" });
	if (message.includes("forbidden") || message.includes("not enough rights")) return new TelegramTransportError({ code: "forbidden" });
	if (message.includes("not found")) return new TelegramTransportError({ code: "not_found" });
	if (message.includes("timeout")) return new TelegramTransportError({ code: "provider_timeout", phase: "after_possible_send" });
	if (message.includes("network") || message.includes("fetch")) return new TelegramTransportError({ code: "network", phase: "after_possible_send" });
	return new TelegramTransportError({ code: "unknown" });
}
