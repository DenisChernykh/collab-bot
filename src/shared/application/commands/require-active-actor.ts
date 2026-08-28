import type { CommandActor } from "./command-contracts.js";
import type { SafeResult } from "./safe-result.js";
import type { TelegramUserLookup } from "../ports/telegram-user-lookup.js";

export interface TelegramUserIngressActor {
	readonly kind: "telegram_user";
	readonly telegramUserId: string;
}

export function normalizeTelegramUserActor(value: unknown): TelegramUserIngressActor | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as { readonly kind?: unknown; readonly telegramUserId?: unknown };
	if (candidate.kind !== "telegram_user" || typeof candidate.telegramUserId !== "string") {
		return undefined;
	}
	if (!/^[0-9]+$/.test(candidate.telegramUserId)) {
		return undefined;
	}
	return { kind: "telegram_user", telegramUserId: candidate.telegramUserId };
}

export interface ActiveActorAllowed {
	readonly allowed: true;
	readonly actor: TelegramUserIngressActor;
}

export interface ActiveActorDenied {
	readonly allowed: false;
	readonly result: SafeResult;
}

export type ActiveActorDecision = ActiveActorAllowed | ActiveActorDenied;

export class RequireActiveActor {
	constructor(private readonly users: TelegramUserLookup) {}

	async check(actor: CommandActor | unknown): Promise<ActiveActorDecision> {
		const normalized = normalizeTelegramUserActor(actor);
		if (normalized === undefined) {
			return unavailable();
		}
		const user = await this.users.findByTelegramUserId(normalized.telegramUserId);
		if (user === undefined) {
			return unavailable();
		}
		if (user.status === "blocked") {
			return {
				allowed: false,
				result: { version: 1, outcome: "blocked", messageKey: "actor_blocked" },
			};
		}
		return { allowed: true, actor: normalized };
	}
}

function unavailable(): ActiveActorDenied {
	return {
		allowed: false,
		result: { version: 1, outcome: "unavailable", messageKey: "actor_unavailable" },
	};
}
