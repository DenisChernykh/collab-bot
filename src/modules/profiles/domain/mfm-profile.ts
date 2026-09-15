import { DomainValidationError } from "../../../shared/domain/value-objects/enums.js";

export const MFM_EVENT_STATUSES = ["participant", "citizen_program", "volunteer"] as const;
export const MFM_PROFILE_TYPES = ["specialist", "media", "project", "business"] as const;
export const MFM_OPEN_TO = ["joint_projects", "professional_communication", "city_and_events"] as const;
export const MFM_SPHERES = ["public_administration", "media", "science_education", "entrepreneurship", "digital_it", "creative_industries", "civic_engagement", "sports_health"] as const;
export type MfmSphere = (typeof MFM_SPHERES)[number];
export type Language = "ru" | "en";
export type Experience = "undecided" | "classic" | "mfm";
export type MfmContact =
	| { readonly kind: "telegram_user" }
	| { readonly kind: "telegram_channel" | "telegram_group"; readonly url: string; readonly username: string; readonly telegramChatId: string; readonly title?: string }
	| { readonly kind: "external"; readonly url: string };
export interface MfmPhoto { readonly fileId: string; readonly botId: string; }
export function validateMfmPhoto(value: unknown): MfmPhoto {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DomainValidationError("invalid profile photo");
	const v = value as Record<string, unknown>;
	if (typeof v.fileId !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(v.fileId) || typeof v.botId !== "string" || !/^[1-9][0-9]{0,19}$/.test(v.botId) || Object.keys(v).some(key => key !== "fileId" && key !== "botId")) throw new DomainValidationError("invalid profile photo");
	return { fileId: v.fileId, botId: v.botId };
}
export interface MfmProfileInput {
	readonly photo?: MfmPhoto | null;
	readonly eventStatus: (typeof MFM_EVENT_STATUSES)[number];
	readonly displayName: string;
	readonly profileType: (typeof MFM_PROFILE_TYPES)[number];
	readonly locationText: string;
	readonly spheres: readonly MfmSphere[];
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
export function validateMfmProfile(value: unknown): MfmProfileInput {
	if (typeof value !== "object" || value === null) throw new DomainValidationError("invalid MFM profile");
	const input = value as Record<string, unknown>;
	const spheres = choices(input.spheres, MFM_SPHERES, 1);
	return {
		eventStatus: mfmValue(input.eventStatus, MFM_EVENT_STATUSES),
		displayName: mfmText(input.displayName, 100),
		profileType: mfmValue(input.profileType, MFM_PROFILE_TYPES),
		locationText: mfmText(input.locationText, 200),
		spheres, openTo: choices(input.openTo, MFM_OPEN_TO, 1),
		photo: input.photo === undefined || input.photo === null ? null : validateMfmPhoto(input.photo),
		about: input.about === undefined || input.about === null ? null : mfmAbout(input.about),
	};
}
export function mfmAbout(value: unknown): string {
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
