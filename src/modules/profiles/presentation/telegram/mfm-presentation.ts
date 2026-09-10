import { InlineKeyboard } from "grammy";
import type { OnboardingAction, OnboardingView } from "../../application/onboarding-service.js";
import { MFM_EVENT_STATUSES, MFM_PROFILE_TYPES, MFM_SPHERES, MFM_SPECIALIZATIONS, MFM_OPEN_TO, type Language, type MfmProfileInput } from "../../domain/mfm-profile.js";
import { COPY, EVENT_LABELS, TYPE_LABELS, SPHERE_LABELS, SPECIALIZATION_LABELS, OPEN_TO_LABELS, NOTICES, tr, type Translation } from "./mfm-copy.js";
import { encodeMfmCallback } from "./mfm-callback-codec.js";

export function renderOnboarding(view: Exclude<OnboardingView, { kind: "classic" }>): { text: string; keyboard: InlineKeyboard };
export function renderOnboarding(view: OnboardingView): { text: string; keyboard: InlineKeyboard };
export function renderOnboarding(view: OnboardingView): { text: string; keyboard: InlineKeyboard } {
	const language = view.language;
	const t = (value: Translation) => tr(value, language);
	const keyboard = new InlineKeyboard();
	const prefix = view.notice === undefined ? "" : `${t(NOTICES[view.notice])}\n\n`;
	if (view.notice === "paused" && view.kind === "step") return { text: t(NOTICES.paused), keyboard: keyboard.text(t(COPY.resume), "mfm:resume") };
	if (view.kind === "home") return { text: prefix + ownProfile(view.profile, language, view.festivalEnabled), keyboard: keyboard.text(t(COPY.edit), "mfm:edit") };
	if (view.kind === "classic") throw new Error("classic rendering belongs to the existing router");
	if (view.kind !== "step") return { text: prefix + t(COPY[view.kind]), keyboard };
	const { session } = view;
	const { step, draft, page, editing } = session.state;
	let text: string = t(COPY[step]);
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
		case "intro": button(t(COPY.create), { kind: "next" }); break;
		case "display_name":
			if (draft.displayName !== undefined) { text += `\n\n${draft.displayName}`; button(t(COPY.keep), { kind: "keep" }); }
			break;
		case "profile_type": for (const key of MFM_PROFILE_TYPES) choice(key, TYPE_LABELS[key], draft.profileType === key); break;
		case "location":
			if (draft.locationText !== undefined) { text += `\n\n${draft.locationText}`; button(t(COPY.keep), { kind: "keep" }); }
			button(t(COPY.city), { kind: "city" });
			break;
		case "spheres":
			text += `\n\n${t(COPY.selected)}: ${draft.spheres?.length ?? 0}/3`;
			for (const key of MFM_SPHERES) choice(key, SPHERE_LABELS[key], draft.spheres?.includes(key));
			button(t(COPY.done), { kind: "next" });
			break;
		case "specializations": {
			const spheres = draft.spheres ?? [];
			const sphere = spheres[Math.min(page, Math.max(0, spheres.length - 1))];
			text += `\n\n${t(COPY.selected)}: ${draft.specializations?.length ?? 0}/3`;
			if (sphere !== undefined) {
				text += `\n${t(SPHERE_LABELS[sphere])} (${page + 1}/${spheres.length})`;
				for (const key of MFM_SPECIALIZATIONS[sphere]) choice(key, SPECIALIZATION_LABELS[key], draft.specializations?.includes(key));
			}
			if (page > 0) button("◀", { kind: "page", value: String(page - 1) });
			if (page + 1 < spheres.length) button("▶", { kind: "page", value: String(page + 1) });
			button(t(COPY.done), { kind: "next" });
			break;
		}
		case "open_to":
			for (const key of MFM_OPEN_TO) choice(key, OPEN_TO_LABELS[key], draft.openTo?.includes(key));
			button(t(COPY.done), { kind: "next" });
			break;
	}
	if (step !== "language" && step !== "affiliation") {
		if (!(editing && step === "display_name")) button(t(COPY.back), { kind: "back" });
		button(t(editing ? COPY.cancel : COPY.later), { kind: "cancel" });
	}
	return { text: prefix + text, keyboard };
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
