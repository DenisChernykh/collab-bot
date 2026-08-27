import { describe, expect, it, vi } from "vitest";
import { GrammyError } from "grammy";

import { TelegramTransportError } from "../../src/application/ports/telegram-transport.js";
import { GrammyTelegramTransport } from "../../src/infrastructure/telegram/grammy-telegram-transport.js";

describe("S2-02 Telegram transport", () => {
	it("renders channel send and edit payloads as HTML", async () => {
		const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
		const editMessageText = vi.fn().mockResolvedValue(true);
		const transport = new GrammyTelegramTransport({ api: { sendMessage, editMessageText } } as never);
		const signal = new AbortController().signal;

		await transport.execute({ method: "send", chatId: "-1001", text: "<b>Карточка</b>", signal });
		await transport.execute({ method: "edit", chatId: "-1001", messageId: 42, text: "<b>Обновлено</b>", signal });

		expect(sendMessage).toHaveBeenCalledWith("-1001", "<b>Карточка</b>", { parse_mode: "HTML" }, signal);
		expect(editMessageText).toHaveBeenCalledWith("-1001", 42, "<b>Обновлено</b>", { parse_mode: "HTML" }, signal);
	});

	it("classifies delete-specific not-found as known success without changing generic not-found", async () => {
		const description = "Bad Request: message to delete not found";
		const deleteMessage = vi.fn().mockRejectedValue(grammyError(description, "deleteMessage"));
		const editMessageText = vi.fn().mockRejectedValue(grammyError(description, "editMessageText"));
		const transport = new GrammyTelegramTransport({ api: { deleteMessage, editMessageText } } as never);
		const signal = new AbortController().signal;

		await expect(transport.execute({ method: "delete", chatId: "-1001", messageId: 42, signal }))
			.rejects.toMatchObject({ code: "message_not_found" } satisfies Partial<TelegramTransportError>);
		await expect(transport.execute({ method: "edit", chatId: "-1001", messageId: 42, text: "Updated", signal }))
			.rejects.toMatchObject({ code: "not_found" } satisfies Partial<TelegramTransportError>);
	});
});

function grammyError(description: string, method: string): GrammyError {
	return new GrammyError(
		`Call to '${method}' failed!`,
		{ ok: false, error_code: 400, description },
		method,
		{},
	);
}
