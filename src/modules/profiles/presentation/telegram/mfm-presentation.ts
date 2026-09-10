import { InlineKeyboard, Keyboard } from "grammy";
import type { OnboardingAction, OnboardingView } from "../../application/onboarding-service.js";
import type { OnboardingSession } from "../../application/ports/onboarding-repository.js";
import { MFM_EVENT_STATUSES, MFM_PROFILE_TYPES, MFM_SPECIALIZATIONS, MFM_SPHERES, type Language, type MfmProfileInput } from "../../domain/mfm-profile.js";
import { COPY, EVENT_LABELS, TYPE_LABELS, SPHERE_LABELS, SPECIALIZATION_LABELS, OPEN_TO_LABELS, NOTICES, tr, type Translation } from "./mfm-copy.js";
import { encodeMfmCallback } from "./mfm-callback-codec.js";

type OnboardingKeyboard = InlineKeyboard | Keyboard;
export function renderOnboarding(view: Exclude<OnboardingView, { kind: "classic" }>): { text: string; keyboard: OnboardingKeyboard };
export function renderOnboarding(view: OnboardingView): { text: string; keyboard: OnboardingKeyboard };
export function renderOnboarding(view: OnboardingView): { text: string; keyboard: OnboardingKeyboard } {
	const language = view.language;
	const t = (value: Translation) => tr(value, language);
	const keyboard = new InlineKeyboard();
	const prefix = view.notice === undefined ? "" : `${t(NOTICES[view.notice])}\n\n`;
	if (view.notice === "paused" && view.kind === "step") return { text: t(NOTICES.paused), keyboard: keyboard.text(t(COPY.resume), "mfm:resume") };
	if (view.kind === "home") return { text: prefix + ownProfile(view.profile, language, view.festivalEnabled), keyboard: keyboard.text(t(COPY.edit), "mfm:edit").row().text(t(COPY.improve), "mfm:improve") };
	if (view.kind === "classic") throw new Error("classic rendering belongs to the existing router");
	if (view.kind !== "step") return { text: prefix + t(COPY[view.kind]), keyboard };
	const { session } = view;
	const { step, draft, editing, page } = session.state;
	if (step === "contact") {
		const requestIds = contactRequestIds(session);
		const contactKeyboard = new Keyboard()
			.text(t(COPY.contactTelegram)).row()
			.requestChat(t(COPY.contactChannel), requestIds.channel, { chat_is_channel: true, request_title: true, request_username: true }).row()
			.requestChat(t(COPY.contactGroup), requestIds.group, { chat_is_channel: false, request_title: true, request_username: true }).row()
			.text(t(COPY.contactOther)).text(t(COPY.skip)).row()
			.text(t(COPY.back));
		if (editing) contactKeyboard.text(t(COPY.cancel));
		contactKeyboard.resized().oneTime();
		return { text: prefix + t(COPY.contact), keyboard: contactKeyboard };
	}
	let text: string = t(step === "enrichment_specializations" ? COPY.specializations : COPY[step]);
	const button = (label: string, action: OnboardingAction) => keyboard.text(label, encodeMfmCallback(action, session)).row();
	const choice = (value: string, label: Translation, selected = false) => button(`${selected ? "✅ " : ""}${t(label)}`, { kind: "choice", value });
	switch (step) {
		case "language":
			button("🇷🇺 Русский", { kind: "language", value: "ru" });
			button("🇬🇧 English", { kind: "language", value: "en" });
			break;
		case "affiliation":
			button(t(["🌍 Да", "🌍 Yes"]), { kind: "affiliation", value: "yes" });
			button(t(["Нет", "No"]), { kind: "affiliation", value: "no" });
			break;
		case "event_status": for (const key of MFM_EVENT_STATUSES) choice(key, EVENT_LABELS[key], draft.eventStatus === key); break;
		case "display_name":
			if (draft.displayName !== undefined) {
				text += "\n\n" + t(COPY.displayNameCurrent) + ": " + draft.displayName + "\n\n" + t(COPY.displayNameHint);
				button(t(COPY.keep), { kind: "keep" });
			}
			break;
		case "profile_type": for (const key of MFM_PROFILE_TYPES) choice(key, TYPE_LABELS[key], draft.profileType === key); break;
		case "location":
			if (draft.locationText !== undefined) { text += `\n\n${draft.locationText}`; button(t(COPY.keep), { kind: "keep" }); }
			button(t(COPY.city), { kind: "city" });
			break;
		case "spheres":
			text += `\n\n${t(COPY.selected)}: ${draft.spheres?.length ?? 0} ${t(COPY.ofThree)}`;
			for (const key of MFM_SPHERES) choice(key, SPHERE_LABELS[key], draft.spheres?.includes(key));
			if ((draft.spheres?.length ?? 0) > 0) button(t(COPY.continue), { kind: "next" });
			break;
		case "enrichment_specializations": {
			const spheres = draft.spheres ?? [];
			const sphere = spheres[Math.min(page, Math.max(0, spheres.length - 1))];
			text += `\n\n${t(COPY.selected)}: ${draft.specializations?.length ?? 0} ${t(COPY.ofThree)}`;
			if (sphere !== undefined) {
				text += `\n${t(SPHERE_LABELS[sphere])} (${page + 1}/${spheres.length})`;
				for (const key of MFM_SPECIALIZATIONS[sphere]) choice(key, SPECIALIZATION_LABELS[key], draft.specializations?.includes(key));
			}
			if (page > 0) button("◀", { kind: "page", value: String(page - 1) });
			if (page + 1 < spheres.length) button("▶", { kind: "page", value: String(page + 1) });
			button(t(COPY.save), { kind: "next" });
			break;
		}
	}
	if (step !== "language" && step !== "affiliation") {
		if (!(editing && step === "display_name")) button(t(COPY.back), { kind: "back" });
		if (editing) button(t(COPY.cancel), { kind: "cancel" });
	}
	return { text: prefix + text, keyboard };
}
export function contactRequestIds(session: OnboardingSession): { readonly channel: number; readonly group: number } {
	const revision = session.revision >>> 0;
	const normalize = (value: number) => ((value >>> 0) % 2_147_483_646) + 1;
	const channel = normalize(parseInt(session.state.generation.slice(0, 8), 16) ^ revision);
	let group = normalize(parseInt(session.state.generation.slice(8), 16) ^ Math.imul(revision || 1, 0x45d9f3b));
	if (group === channel) group = group === 2_147_483_647 ? 1 : group + 1;
	return { channel, group };
}
function ownProfile(profile: MfmProfileInput, language: Language, festivalEnabled: boolean): string {
	return `${tr(COPY.home, language)}\n\n${renderMfmProfile(profile, language, festivalEnabled)}`;
}
export function renderMfmProfile(profile: MfmProfileInput, language: Language, festivalEnabled: boolean): string {
	const t = (value: Translation) => tr(value, language);
	return [profile.displayName,
		...(festivalEnabled ? [t(EVENT_LABELS[profile.eventStatus])] : []),
		`${t(COPY.typeLabel)}: ${t(TYPE_LABELS[profile.profileType])}`,
		`${t(COPY.locationLabel)}: ${profile.locationText}`,
		`${t(COPY.spheresLabel)}: ${profile.spheres.map((x) => t(SPHERE_LABELS[x])).join(", ")}`,
		`${t(COPY.specializationsLabel)}: ${profile.specializations.map((x) => t(SPECIALIZATION_LABELS[x])).join(", ")}`,
		`${t(COPY.openToLabel)}: ${profile.openTo.map((x) => t(OPEN_TO_LABELS[x])).join(", ")}`,
	].join("\n");
}
