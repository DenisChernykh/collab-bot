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
export interface MfmProfileInput {
	readonly eventStatus: (typeof MFM_EVENT_STATUSES)[number];
	readonly displayName: string;
	readonly profileType: (typeof MFM_PROFILE_TYPES)[number];
	readonly locationText: string;
	readonly spheres: readonly MfmSphere[];
	readonly specializations: readonly MfmSpecialization[];
	readonly openTo: readonly (typeof MFM_OPEN_TO)[number][];
}
export type MfmDraft = Partial<MfmProfileInput>;
export interface MfmProfileRecord extends MfmProfileInput {
	readonly profileId: string;
	readonly completedAt: number;
	readonly updatedAt: number;
	readonly revision: number;
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
	const spheres = choices(input.spheres, MFM_SPHERES);
	const specializations = choices(input.specializations, Object.values(MFM_SPECIALIZATIONS).flat());
	if (!specializations.every((key) => spheres.includes(specializationSphere(key)))) throw new DomainValidationError("specialization must belong to a selected sphere");
	return {
		eventStatus: mfmValue(input.eventStatus, MFM_EVENT_STATUSES),
		displayName: mfmText(input.displayName, 100),
		profileType: mfmValue(input.profileType, MFM_PROFILE_TYPES),
		locationText: mfmText(input.locationText, 200),
		spheres, specializations, openTo: choices(input.openTo, MFM_OPEN_TO),
	};
}
function choices<T extends string>(value: unknown, allowed: readonly T[]): readonly T[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 3 || new Set(value).size !== value.length) throw new DomainValidationError("select one to three distinct MFM choices");
	return value.map((key: unknown) => mfmValue(key, allowed));
}
