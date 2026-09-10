import type { DeliverySendPayload } from "../../../shared/application/outbox/delivery-payload.js";
import type { Language } from "../../profiles/application/index.js";
import type { IntroductionRecord } from "./introduction-contracts.js";

export function introductionNotification(request: IntroductionRecord, senderName: string, language: Language, botUsername: string): DeliverySendPayload {
	if (!/^[A-Za-z0-9_]{1,64}$/.test(botUsername) || !/^[A-Za-z0-9_-]{22}$/.test(request.token)) throw new Error("invalid introduction link");
	const ru = language === "ru";
	const headline = request.status === "pending" ? (ru ? "Новое знакомство" : "New introduction")
		: request.status === "accepted" ? (ru ? "Знакомство принято ✅" : "Introduction accepted ✅")
			: request.status === "rejected" ? (ru ? "Запрос отклонён" : "Introduction declined")
				: (ru ? "Запрос отозван" : "Introduction withdrawn");
	return { version: 1, method: "send", text: `${headline}\n${senderName}${request.status === "pending" ? `\n\n${request.message}` : ""}`, replyMarkup: { inline_keyboard: [[{ text: ru ? "Открыть запрос" : "Open introduction", url: `https://t.me/${botUsername}?start=n_${request.token}` }]] } };
}
