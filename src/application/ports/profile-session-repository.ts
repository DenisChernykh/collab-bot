import type { ProfileInput } from "../../domain/profiles/profile.js";

export const PROFILE_SESSION_VERSION = 1 as const;
export const PROFILE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ProfileSessionStep =
	| "type"
	| "display_name"
	| "topics"
	| "description"
	| "platform"
	| "platform_url"
	| "audience"
	| "review";

export interface ProfileDraft {
	readonly type?: ProfileInput["type"];
	readonly displayName?: string;
	readonly topics?: ProfileInput["topics"];
	readonly description?: string;
	readonly platform?: ProfileInput["platforms"][number];
}

export interface ProfileSessionState {
	readonly version: typeof PROFILE_SESSION_VERSION;
	readonly generation: string;
	readonly step: ProfileSessionStep;
	readonly draft: ProfileDraft;
	readonly requestId?: number;
}

export interface ProfileSessionRecord {
	readonly telegramUserId: string;
	readonly state: ProfileSessionState;
	readonly revision: number;
	readonly expiresAt: number;
	readonly updatedAt: number;
}

export interface ProfileSessionRepository {
	findActive(telegramUserId: string, now: number): Promise<ProfileSessionRecord | undefined>;
	save(record: ProfileSessionRecord): Promise<void>;
	delete(telegramUserId: string): Promise<void>;
}
