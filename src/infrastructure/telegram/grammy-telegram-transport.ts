import { GrammyError, type Bot } from "grammy";
import type { TelegramTransport, TelegramTransportRequest, TelegramTransportResponse } from "../../shared/application/ports/telegram-transport.js";
import { TelegramTransportError } from "../../shared/application/ports/telegram-transport.js";

export class GrammyTelegramTransport implements TelegramTransport {
	constructor(private readonly bot: Bot) {}

	async execute(request: TelegramTransportRequest): Promise<TelegramTransportResponse> {
		try {
			if (request.method === "send") {
				const result = await this.bot.api.sendMessage(request.chatId, request.text, {
					parse_mode: "HTML",
					...(request.replyMarkup === undefined ? {} : { reply_markup: request.replyMarkup as never }),
				}, request.signal as never);
				return { method: "send", messageId: result.message_id };
			}
			if (request.method === "edit") {
				await this.bot.api.editMessageText(request.chatId, request.messageId, request.text, {
					parse_mode: "HTML",
					...(request.replyMarkup === undefined ? {} : { reply_markup: request.replyMarkup as never }),
				}, request.signal as never);
				return { method: "edit" };
			}
			await this.bot.api.deleteMessage(request.chatId, request.messageId, request.signal as never);
			return { method: "delete" };
		} catch (error) {
			throw classify(request, error);
		}
	}
}

function classify(request: TelegramTransportRequest, error: unknown): TelegramTransportError {
	const message = [
		error instanceof GrammyError ? error.description : "",
		error instanceof Error ? error.message : "",
	].join(" ").toLowerCase();
	if (message.includes("too many requests") || message.includes("retry after")) return new TelegramTransportError({ code: "rate_limited" });
	if (message.includes("forbidden") || message.includes("not enough rights")) return new TelegramTransportError({ code: "forbidden" });
	if (request.method === "delete" && /message(?: to delete)? not found/.test(message)) return new TelegramTransportError({ code: "message_not_found" });
	if (message.includes("not found")) return new TelegramTransportError({ code: "not_found" });
	if (message.includes("timeout")) return new TelegramTransportError({ code: "provider_timeout", phase: "after_possible_send" });
	if (message.includes("network") || message.includes("fetch")) return new TelegramTransportError({ code: "network", phase: "after_possible_send" });
	return new TelegramTransportError({ code: "unknown" });
}
