import { describe, expect, it, vi } from "vitest";

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
});
