import { DomainValidationError } from "../../domain/value-objects/enums.js";
import { MAX_TELEGRAM_MESSAGE_UTF16_LENGTH, type CollaborationRecord } from "../../domain/collaborations/collaboration.js";
import type { CollaborationDraftInput } from "../../domain/collaborations/collaboration.js";

export function renderCollaborationCard(value: CollaborationRecord | CollaborationDraftInput, options: { readonly expired?: boolean } = {}): string {
	const format = "format" in value && value.format !== undefined && value.format !== null ? value.format : "—";
	const target = "targetProfileType" in value && value.targetProfileType !== undefined && value.targetProfileType !== null ? value.targetProfileType : "—";
	const topics = "topics" in value && value.topics !== undefined && value.topics.length > 0 ? value.topics.join(", ") : "—";
	const title = "title" in value && value.title !== undefined && value.title !== null ? value.title : "—";
	const offer = "offerText" in value && value.offerText !== undefined && value.offerText !== null ? value.offerText : "—";
	const expectation = "expectationText" in value && value.expectationText !== undefined && value.expectationText !== null ? value.expectationText : "—";
	const slots = "slotsTotal" in value && value.slotsTotal !== undefined && value.slotsTotal !== null ? String(value.slotsTotal) : "—";
	const deadline = "responseDeadlineDate" in value && value.responseDeadlineDate !== undefined
		? value.responseDeadlineDate
		: "responseDeadlineAt" in value && value.responseDeadlineAt !== undefined && value.responseDeadlineAt !== null
			? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value.responseDeadlineAt))
			: "—";
	const eventDate = "eventDateLocal" in value && value.eventDateLocal !== undefined && value.eventDateLocal !== null ? value.eventDateLocal : "не указана";
	const rendered = [
		"<b>Коллаборация</b>",
		`<b>${escapeHtml(title)}</b>`,
		"",
		`Формат: ${escapeHtml(String(format))}`,
		`Кого ищут: ${escapeHtml(String(target))}`,
		`Темы: ${escapeHtml(String(topics))}`,
		`Что предлагает автор: ${escapeHtml(String(offer))}`,
		`Что ожидает автор: ${escapeHtml(String(expectation))}`,
		`Мест: ${escapeHtml(slots)}`,
		`Дедлайн откликов: ${escapeHtml(String(deadline))}`,
		`Дата проведения: ${escapeHtml(String(eventDate))}`,
		"Город: Екатеринбург",
		...(options.expired ? ["", "<b>Приём откликов завершён</b>"] : []),
	].join("\n");
	assertTelegramTextFits(rendered);
	return rendered;
}

export function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function assertTelegramTextFits(value: string): void {
	if (value.length > MAX_TELEGRAM_MESSAGE_UTF16_LENGTH) throw new DomainValidationError("collaboration preview exceeds Telegram message limit");
}
