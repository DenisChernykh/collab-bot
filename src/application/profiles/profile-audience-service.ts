import type { Clock } from "../ports/clock.js";
import type { ProviderDeadline } from "../ports/provider-deadline.js";
import type { TransactionRunner } from "../ports/transaction-runner.js";
import type { ProfilePlatformRecord, ProfileRecord } from "../../domain/profiles/profile.js";

export type AudienceAutofillIntent = "allow" | "suppress";

export type TelegramAudienceTarget =
	| { readonly kind: "chat_id"; readonly value: string }
	| { readonly kind: "username"; readonly value: `@${string}` };

export type TelegramAudienceFailureCode =
	| "forbidden"
	| "not_found"
	| "invalid_target"
	| "rate_limited"
	| "network"
	| "unknown";

export class TelegramAudienceLookupError extends Error {
	constructor(readonly code: TelegramAudienceFailureCode) {
		super("Telegram audience lookup failed");
		this.name = "TelegramAudienceLookupError";
	}
}

export interface TelegramAudienceReader {
	getChatMemberCount(target: TelegramAudienceTarget, signal: AbortSignal): Promise<number>;
}

export interface ProfileAudienceWriter {
	storeTelegramAudienceIfMissing(input: {
		readonly profileId: string;
		readonly platformId: string;
		readonly audienceSize: number;
		readonly observedAt: number;
	}): Promise<boolean>;
}

declare module "../ports/profile-session-repository.js" {
	interface ProfileDraft {
		readonly audienceAutofill?: AudienceAutofillIntent;
	}
}

export interface ProfileAudiencePlan {
	readonly profileId: string;
	readonly platformId: string;
	readonly target: TelegramAudienceTarget;
}

export type ProfileAudienceOutcome =
	| { readonly kind: "applied"; readonly audienceSize: number }
	| { readonly kind: "stale" }
	| { readonly kind: "unavailable" };

export class ProfileAudienceService {
	constructor(
		private readonly reader: TelegramAudienceReader,
		private readonly writer: ProfileAudienceWriter,
		private readonly transactions: TransactionRunner,
		private readonly clock: Clock,
		private readonly deadline: ProviderDeadline,
	) {}

	plan(profile: ProfileRecord, intent: AudienceAutofillIntent): ProfileAudiencePlan | undefined {
		if (intent === "suppress") return undefined;
		const candidates = profile.platforms.flatMap((platform) => {
			const target = audienceTarget(platform);
			return target === undefined ? [] : [{
				profileId: profile.id,
				platformId: platform.id,
				target,
			}];
		});
		return candidates.length === 1 ? candidates[0] : undefined;
	}

	async execute(plan: ProfileAudiencePlan): Promise<ProfileAudienceOutcome> {
		let audienceSize: number;
		try {
			audienceSize = await this.deadline.run(undefined, (signal) => this.reader.getChatMemberCount(plan.target, signal));
		} catch {
			return { kind: "unavailable" };
		}
		if (!Number.isSafeInteger(audienceSize) || audienceSize < 0) return { kind: "unavailable" };
		const observedAt = this.clock.now().getTime();
		if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
			throw new RangeError("profile audience clock returned an unsafe timestamp");
		}
		const stored = await this.transactions.withTransaction(() => this.writer.storeTelegramAudienceIfMissing({
			profileId: plan.profileId,
			platformId: plan.platformId,
			audienceSize,
			observedAt,
		}));
		return stored ? { kind: "applied", audienceSize } : { kind: "stale" };
	}
}

function audienceTarget(platform: ProfilePlatformRecord): TelegramAudienceTarget | undefined {
	if (platform.platformType !== "telegram" || platform.audienceSize !== undefined) return undefined;
	const username = canonicalTelegramUsername(platform);
	if (username === undefined) return undefined;
	if (platform.telegramChatId !== undefined && /^-[1-9]\d*$/.test(platform.telegramChatId)) {
		return { kind: "chat_id", value: platform.telegramChatId };
	}
	return { kind: "username", value: `@${username}` };
}

function canonicalTelegramUsername(platform: ProfilePlatformRecord): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(platform.url);
	} catch {
		return undefined;
	}
	const match = /^\/([A-Za-z0-9_]{5,32})$/.exec(parsed.pathname);
	const username = match?.[1];
	if (
		parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "t.me" ||
		parsed.port !== "" || parsed.search !== "" || parsed.hash !== "" || username === undefined ||
		platform.url !== `https://t.me/${username}` ||
		(platform.username !== undefined && platform.username !== username)
	) return undefined;
	return username;
}
