import { InlineKeyboard } from "grammy";
import { EVENT_LABELS, SPHERE_LABELS, OPEN_TO_LABELS, renderMfmProfile, tr, type Translation } from "../../../profiles/index.js";
import { FILTER_FIELDS, filterChoices, type ConnectionAction, type ConnectionView, type FilterField } from "../../application/index.js";
import { encodeConnectionCallback } from "./connection-callback-codec.js";
import { encodeIntroductionCallback } from "./introduction-callback-codec.js";

const FIELDS: Record<FilterField, Translation> = { eventStatus: ["Участие", "Participation"], sphere: ["Сфера", "Field"], openTo: ["К чему открыт", "Open to"] };
const LABELS: Record<FilterField, Readonly<Record<string, Translation>>> = { eventStatus: EVENT_LABELS, sphere: SPHERE_LABELS, openTo: OPEN_TO_LABELS };
const PURPOSE: Translation = ["Для чего хотите познакомиться?", "Why would you like to connect?"];
const PURPOSE_LABELS: Readonly<Record<string, Translation>> = {
	joint_projects: ["🤝 Для совместного проекта", "🤝 For a joint project"],
	professional_communication: ["💬 Для профессионального знакомства", "💬 For a professional introduction"],
	city_and_events: ["🌆 Для прогулки / мероприятия", "🌆 For a walk / event"],
};
export function renderConnection(view: ConnectionView, introductions = false): { text: string; keyboard: InlineKeyboard } {
	const keyboard = new InlineKeyboard();
	if (view.kind === "unavailable") return { text: "Раздел недоступен. /start\nUnavailable. /start", keyboard };
	const t = (value: Translation) => tr(value, view.language);
	const button = (label: Translation | string, action: ConnectionAction) => keyboard.text(typeof label === "string" ? label : t(label), encodeConnectionCallback(action, view.session)).row();
	const { filters, offset } = view.session.state;
	let text: string;
	if (view.kind === "home" || view.kind === "profile") {
		text = t(["👤 Мой профиль", "👤 My profile"]) + "\n\n" + renderMfmProfile(view.profile, view.language, view.festivalEnabled);
		text += "\n\n" + t(view.visible ? ["Ваш профиль виден в поиске.", "Your profile is visible in search."] : ["Ваш профиль скрыт из поиска.", "Your profile is hidden from search."]);
		if (view.kind === "profile") {
			if (view.visible) button(["Скрыть из поиска", "Hide from search"], { kind: "visibility", value: false });
			else if (view.festivalEnabled) button(["👁 Показывать в поиске", "👁 Show in search"], { kind: "visibility", value: true });
			keyboard.text(t(["✏️ Изменить профиль", "✏️ Edit profile"]), "mfm:edit").row();
		}
		if (view.festivalEnabled) button(["🔎 Найти людей", "🔎 Find people"], filters.openTo === undefined ? { kind: "choose_filter", field: "openTo" } : { kind: "open", screen: "search" });
		if (introductions) keyboard.text(t(["🤝 Мои знакомства", "🤝 My introductions"]), encodeIntroductionCallback({ kind: "list", tab: "incoming" }, view.session)).row();
		button(["👤 Мой профиль", "👤 My profile"], { kind: "open", screen: "profile" });
	} else if (view.kind === "filter") {
		const field = view.session.state.filterField ?? "eventStatus";
		text = t(field === "openTo" ? PURPOSE : FIELDS[field]);
		for (const value of filterChoices(field, filters)) {
			const label = (field === "openTo" ? PURPOSE_LABELS : LABELS[field])[value]!;
			button(`${filters[field] === value ? "✅ " : ""}${t(label)}`, { kind: "set_filter", field, value });
		}
		button(field === "openTo" ? ["Любая цель", "Any purpose"] : ["Любой вариант", "Any"], { kind: "set_filter", field, value: null });
	} else {
		const chosen = FILTER_FIELDS.flatMap(field => filters[field] === undefined ? [] : [t(LABELS[field][filters[field]!]!)]);
		text = t(["🔎 Найти людей", "🔎 Find people"]) + (chosen.length === 0 ? "" : `\n${chosen.join(" · ")}`);
		text += "\n\n" + (view.person === null ? t(["Пока никого по этим условиям. Попробуйте сбросить фильтры.", "No people match yet. Try resetting the filters."]) : renderMfmProfile(view.person, view.language, view.festivalEnabled));
		if (introductions && view.person !== null) keyboard.text(t(["🤝 Познакомиться", "🤝 Introduce yourself"]), encodeIntroductionCallback({ kind: "begin" }, view.session)).row();
		if (offset > 0) button(["◀ Предыдущий", "◀ Previous"], { kind: "page", delta: -1 });
		if (view.hasNext) button(["Следующий ▶", "Next ▶"], { kind: "page", delta: 1 });
		for (const field of FILTER_FIELDS) button(FIELDS[field], { kind: "choose_filter", field });
		button(["Сбросить фильтры", "Reset filters"], { kind: "reset_filters" });
	}
	if (view.kind !== "home") button(["← Назад", "← Back"], { kind: "open", screen: view.kind === "filter" ? "search" : "home" });
	if (view.notice !== undefined) {
		const notice: Record<typeof view.notice, Translation> = { stale: ["Кнопка устарела. Продолжите с этого экрана.", "That button is out of date. Continue here."], invalid: ["Выберите вариант кнопкой.", "Choose an option using the buttons."], disabled: ["Поиск сейчас недоступен.", "Discovery is currently unavailable."] };
		text = t(notice[view.notice]) + "\n\n" + text;
	}
	return { text, keyboard };
}
