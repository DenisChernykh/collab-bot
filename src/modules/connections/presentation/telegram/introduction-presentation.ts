import { InlineKeyboard } from "grammy";
import { renderMfmProfile, tr, type Translation } from "../../../profiles/index.js";
import type { IntroductionAction, IntroductionNotice, IntroductionStatus, IntroductionView } from "../../application/index.js";
import { encodeIntroductionCallback } from "./introduction-callback-codec.js";

const STATUS: Record<IntroductionStatus, Translation> = { pending: ["Ожидает ответа", "Awaiting a reply"], accepted: ["Знакомство принято ✅", "Introduction accepted ✅"], rejected: ["Запрос отклонён", "Introduction declined"], withdrawn: ["Запрос отозван", "Introduction withdrawn"] };
const NOTICES: Record<IntroductionNotice, Translation> = { stale: ["Кнопка устарела. Продолжите с этого экрана.", "That button is out of date. Continue here."], invalid: ["Сообщение должно содержать 10–500 символов.", "Your message must contain 10–500 characters."], disabled: ["Новые знакомства сейчас недоступны. Черновик сохранён.", "New introductions are currently unavailable. Your draft is saved."], unavailable: ["Запрос или профиль сейчас недоступен.", "This introduction or profile is currently unavailable."] };
export function renderIntroduction(view: IntroductionView): { text: string; keyboard: InlineKeyboard } {
	const keyboard = new InlineKeyboard();
	if (view.kind === "unavailable") return { text: "Раздел недоступен. /start\nUnavailable. /start", keyboard };
	const t = (value: Translation) => tr(value, view.language);
	const button = (label: Translation, action: IntroductionAction) => keyboard.text(t(label), encodeIntroductionCallback(action, view.session)).row();
	let text = t(["🤝 Мои знакомства", "🤝 My introductions"]);
	if (view.kind === "compose") {
		text = `${view.person?.displayName ?? ""}\n\n${t(["Напишите короткое сообщение: почему хотите познакомиться? 10–500 символов.", "Write a short message: why would you like to connect? 10–500 characters."])}`;
		if (view.message !== null) text += `\n\n${view.message}`;
	} else if (view.kind === "confirm") {
		text = `${view.person?.displayName ?? ""}\n\n${view.message ?? ""}\n\n${t(["Получатель увидит ваш профиль и сообщение. Telegram-контакты откроются вам обоим после принятия запроса.", "The recipient will see your profile and message. Telegram contacts will open for both of you after acceptance."])}`;
		button(["Отправить запрос", "Send introduction"], { kind: "confirm" });
		button(["Изменить сообщение", "Edit message"], { kind: "edit_message" });
	} else if (view.kind === "request" || view.kind === "list") {
		if (view.request !== null && view.person !== null) {
			text = `${t(STATUS[view.request.status])}\n\n${renderMfmProfile(view.person, view.language, view.festivalEnabled)}\n\n${view.request.message}`;
			if (view.kind === "list") button(["Открыть запрос", "Open introduction"], { kind: "show_request" });
			else {
				if (view.canAccept) {
					text += "\n\n" + t(["Принимая запрос, вы открываете Telegram-контакт друг другу.", "Accepting shares your Telegram contacts with each other."]);
					button(["✅ Принять", "✅ Accept"], { kind: "decide", decision: "accepted", requestRevision: view.request.revision });
					button(["Отклонить", "Decline"], { kind: "decide", decision: "rejected", requestRevision: view.request.revision });
				}
				if (view.canWithdraw) button(["Отозвать запрос", "Withdraw introduction"], { kind: "decide", decision: "withdrawn", requestRevision: view.request.revision });
				if (view.contactUrl !== null) {
					keyboard.url(t(["💬 Написать в Telegram", "💬 Message on Telegram"]), view.contactUrl).row();
					text += "\n\n" + t(["Если контакт не открывается, у человека может быть ограничен доступ в Telegram.", "If the contact does not open, their Telegram privacy settings may limit access."]);
				} else if (view.request.status === "accepted") text += "\n\n" + t(["Контакт сейчас недоступен.", "The contact is currently unavailable."]);
			}
		} else if (view.notice === undefined) text += "\n\n" + t(["Пока нет запросов.", "No introductions yet."]);
		if (view.kind === "list") {
			const nav = view.session.state.introduction;
			if (nav?.screen === "list" && nav.offset > 0) button(["◀ Предыдущий", "◀ Previous"], { kind: "page", delta: -1 });
			if (view.hasNext) button(["Следующий ▶", "Next ▶"], { kind: "page", delta: 1 });
			button(["Входящие", "Incoming"], { kind: "list", tab: "incoming" }); button(["Отправленные", "Sent"], { kind: "list", tab: "sent" }); button(["Принятые", "Accepted"], { kind: "list", tab: "accepted" });
		} else button(["Мои знакомства", "My introductions"], { kind: "list", tab: "incoming" });
	}
	button(view.kind === "compose" || view.kind === "confirm" ? ["Отмена", "Cancel"] : ["← Назад", "← Back"], { kind: "cancel" });
	if (view.notice !== undefined) text = `${t(NOTICES[view.notice])}\n\n${text}`;
	return { text, keyboard };
}
