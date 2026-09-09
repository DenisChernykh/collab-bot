import type { Experience, Language, MfmDraft, MfmProfileInput, MfmProfileRecord } from "../../domain/mfm-profile.js";
export const ONBOARDING_STEPS = ["language", "affiliation", "event_status", "intro", "display_name", "profile_type", "location", "spheres", "specializations", "open_to"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export interface OnboardingState {
	readonly version: 1;
	readonly generation: string;
	readonly step: OnboardingStep;
	readonly draft: MfmDraft;
	readonly editing: boolean;
	readonly page: number;
	readonly pendingStart?: string;
	readonly returnStep?: OnboardingStep | "home";
}
export interface OnboardingSession {
	readonly state: OnboardingState;
	readonly revision: number;
	readonly updatedAt: number;
}
export interface ExperienceUser {
	readonly language: Language | null;
	readonly experience: Experience;
	readonly status: "active" | "blocked";
}
export interface OnboardingRepository {
	getUser(userId: string): Promise<ExperienceUser | undefined>;
	setUser(userId: string, language: Language | null, experience: Experience): Promise<void>;
	getSession(userId: string): Promise<OnboardingSession | undefined>;
	saveSession(userId: string, state: OnboardingState, now: number): Promise<OnboardingSession>;
	deleteSession(userId: string): Promise<void>;
	getProfile(userId: string): Promise<MfmProfileRecord | undefined>;
	saveProfile(userId: string, input: MfmProfileInput, now: number): Promise<MfmProfileRecord>;
}
