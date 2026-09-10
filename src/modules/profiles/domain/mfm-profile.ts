import { DomainValidationError } from "../../../shared/domain/value-objects/enums.js";

export const MFM_EVENT_STATUSES = ["participant", "citizen_program", "volunteer"] as const;
export const MFM_PROFILE_TYPES = ["specialist", "media", "project", "business"] as const;
export const MFM_OPEN_TO = ["joint_projects", "professional_communication", "city_and_events"] as const;
export const MFM_SPECIALIZATIONS = {
	public_administration: ["government", "municipal", "youth_policy", "international"],
	media: ["blogger", "journalism", "smm", "pr", "photo_video", "producing"],
	science_education: ["science", "research", "education", "edtech", "teaching"],
	entrepreneurship: ["business", "startups", "finance", "marketing_sales", "ecommerce", "horeca"],
	digital_it: ["development", "ai", "data", "product_project", "ux_ui", "cybersecurity"],
	creative_industries: ["design", "fashion", "music", "cinema", "art", "architecture"],
	civic_engagement: ["social_projects", "volunteering", "ngo", "ecology", "charity"],
	sports_health: ["sport", "fitness", "medicine", "wellness"],
} as const;
export type MfmSphere = keyof typeof MFM_SPECIALIZATIONS;
export const MFM_SPHERES = Object.keys(MFM_SPECIALIZATIONS) as MfmSphere[];
export type MfmSpecialization = (typeof MFM_SPECIALIZATIONS)[MfmSphere][number];
export type Language = "ru" | "en";
export type Experience = "undecided" | "classic" | "mfm";
export type MfmContact =
	| { readonly kind: "telegram_user" }
	| { readonly kind: "telegram_channel" | "telegram_group"; readonly url: string; readonly username: string; readonly telegramChatId: string; readonly title?: string }
	| { readonly kind: "external"; readonly url: string };
export interface MfmProfileInput {
	readonly eventStatus: (typeof MFM_EVENT_STATUSES)[number];
	readonly displayName: string;
	readonly profileType: (typeof MFM_PROFILE_TYPES)[number];
	readonly locationText: string;
	readonly spheres: readonly MfmSphere[];
	readonly specializations: readonly MfmSpecialization[];
	readonly openTo: readonly (typeof MFM_OPEN_TO)[number][];
	readonly about: string | null;
}
export type MfmDraft = Partial<MfmProfileInput>;
export interface MfmProfileRecord extends MfmProfileInput {
	readonly profileId: string;
	readonly contact: MfmContact | null;
	readonly completedAt: number;
	readonly updatedAt: number;
	readonly revision: number;
}
export function validateMfmContact(value: unknown): MfmContact {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DomainValidationError("invalid MFM contact");
	const input = value as Record<string, unknown>;
	const kind = mfmValue(input.kind, ["telegram_user", "telegram_channel", "telegram_group", "external"]);
	if (kind === "telegram_user") {
		if (Object.keys(input).some((key) => key !== "kind")) throw new DomainValidationError("invalid Telegram user contact");
		return { kind };
	}
	const url = canonicalHttpsUrl(input.url);
	if (kind === "external") {
		if (Object.keys(input).some((key) => key !== "kind" && key !== "url")) throw new DomainValidationError("invalid external contact");
		return { kind, url };
	}
	const username = typeof input.username === "string" ? input.username.trim().replace(/^@+/u, "") : "";
	if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(username)) throw new DomainValidationError("invalid Telegram contact username");
	if (url !== `https://t.me/${username}`) throw new DomainValidationError("invalid Telegram contact URL");
	const telegramChatId = typeof input.telegramChatId === "string" ? input.telegramChatId.trim() : "";
	if (!/^-[0-9]{1,20}$/u.test(telegramChatId)) throw new DomainValidationError("invalid Telegram contact chat ID");
	const title = input.title === undefined ? undefined : mfmText(input.title, 100);
	if (Object.keys(input).some((key) => !["kind", "url", "username", "telegramChatId", "title"].includes(key))) throw new DomainValidationError("invalid Telegram contact");
	return { kind, url, username, telegramChatId, ...(title === undefined ? {} : { title }) };
}
export function mfmValue<const T extends string>(value: unknown, allowed: readonly T[]): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) throw new DomainValidationError("invalid MFM choice");
	return value as T;
}
export function mfmText(value: unknown, max: number): string {
	if (typeof value !== "string" || value.includes("\u0000") || value.trim().length < 1 || value.trim().length > max) throw new DomainValidationError("invalid MFM text");
	return value.trim();
}
export function specializationSphere(value: MfmSpecialization): MfmSphere {
	const sphere = MFM_SPHERES.find((key) => (MFM_SPECIALIZATIONS[key] as readonly string[]).includes(value));
	if (sphere === undefined) throw new DomainValidationError("invalid specialization");
	return sphere;
}
export function validateMfmProfile(value: unknown): MfmProfileInput {
	if (typeof value !== "object" || value === null) throw new DomainValidationError("invalid MFM profile");
	const input = value as Record<string, unknown>;
	const spheres = choices(input.spheres, MFM_SPHERES, 1);
	const specializations = choices(input.specializations, Object.values(MFM_SPECIALIZATIONS).flat(), 0);
	if (!specializations.every((key) => spheres.includes(specializationSphere(key)))) throw new DomainValidationError("specialization must belong to a selected sphere");
	return {
		eventStatus: mfmValue(input.eventStatus, MFM_EVENT_STATUSES),
		displayName: mfmText(input.displayName, 100),
		profileType: mfmValue(input.profileType, MFM_PROFILE_TYPES),
		locationText: mfmText(input.locationText, 200),
		spheres, specializations, openTo: choices(input.openTo, MFM_OPEN_TO, 1),
		about: input.about === undefined || input.about === null ? null : mfmAbout(input.about),
	};
}
function mfmAbout(value: unknown): string {
	const text = mfmText(value, 500);
	if (text.length < 10) throw new DomainValidationError("invalid MFM about");
	return text;
}
function choices<T extends string>(value: unknown, allowed: readonly T[], minimum: 0 | 1): readonly T[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > 3 || new Set(value).size !== value.length) throw new DomainValidationError("select up to three distinct MFM choices");
	return value.map((key: unknown) => mfmValue(key, allowed));
}

function canonicalHttpsUrl(value: unknown): string {
	if (typeof value !== "string" || value.includes("\u0000") || value.trim() !== value || value.length > 2_048) throw new DomainValidationError("invalid contact URL");
	let parsed: URL;
	try { parsed = new URL(value); } catch { throw new DomainValidationError("invalid contact URL"); }
	if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") throw new DomainValidationError("invalid contact URL");
	return parsed.toString() === `${value}/` && parsed.pathname === "/" ? value : parsed.toString();
}
