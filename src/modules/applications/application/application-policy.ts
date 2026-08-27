import type {
	ApplicationDecisionCollaboration,
	ApplicationDecisionContext,
	ApplicationDecisionFailureCode,
	ApplicationEligibility,
	ApplicationEligibilityInput,
	ApplicationSubmissionContext,
	RecruitmentDecisionContext,
	TelegramIdentitySnapshot,
} from "./application-contracts.js";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{22}$/;
export const TELEGRAM_USER_ID = /^[1-9][0-9]{0,19}$/;
const TELEGRAM_CHAT_ID = /^-?[1-9][0-9]{0,19}$/;
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const TELEGRAM_BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/;
export const ACTION_ENTITY = /^(?:application|collaboration):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertEligibilityInput(input: ApplicationEligibilityInput): void {
	if (!/^\d+$/.test(input.telegramUserId) || !UUID.test(input.collaborationId) || !Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) {
		throw new RangeError("application eligibility input is invalid");
	}
}

export function assertDecisionInput(telegramUserId: string, entityId: string, occurredAt: number): void {
	if (!TELEGRAM_USER_ID.test(telegramUserId) || !UUID.test(entityId) || !Number.isSafeInteger(occurredAt) || occurredAt < 0) {
		throw new RangeError("application decision input is invalid");
	}
}

export function evaluateEligibility(
	context: ApplicationSubmissionContext | undefined,
	telegramUserId: string,
	occurredAt: number,
): ApplicationEligibility {
	if (context === undefined || context.actorStatus !== "active") return { ok: false, code: "actor_inactive" };
	const target = context.target;
	if (
		target === null || target.status !== "published" || target.publishedAt === null ||
		target.publicToken === null || target.authorProfileStatus !== "active" ||
		target.authorActorStatus !== "active" || target.publicationStatus !== "published" ||
		target.publicationMessageId === null || target.targetProfileType === null ||
		target.slotsTotal === null || target.responseDeadlineAt === null
	) return { ok: false, code: "target_unavailable" };
	if (target.authorTelegramUserId === telegramUserId) return { ok: false, code: "own_collaboration" };
	if (occurredAt > target.responseDeadlineAt) return { ok: false, code: "deadline_passed" };
	if (context.applicant === null) return { ok: false, code: "profile_required" };
	if (target.targetProfileType !== "any" && target.targetProfileType !== context.applicant.type) {
		return { ok: false, code: "profile_type_mismatch" };
	}
	if (context.existingApplicationId !== null) return { ok: false, code: "duplicate" };
	if (context.acceptedCount >= target.slotsTotal) return { ok: false, code: "full" };
	return { ok: true, applicant: context.applicant, target };
}

export function decisionContextFailure(
	context: ApplicationDecisionContext,
	telegramUserId: string,
): { readonly ok: false; readonly code: ApplicationDecisionFailureCode } | undefined {
	if (context.actorStatus !== "active") return { ok: false, code: "actor_inactive" };
	if (
		context.actorTelegramUserId !== telegramUserId ||
		context.collaboration.authorTelegramUserId !== telegramUserId ||
		context.authorProfileId !== context.collaboration.authorProfileId
	) return { ok: false, code: "not_author" };
	if (
		context.application.collaborationId !== context.collaboration.id ||
		!decisionTargetAvailable(context.collaboration) ||
		!Number.isSafeInteger(context.acceptedCount) || context.acceptedCount < 0
	) return { ok: false, code: "target_unavailable" };
	return undefined;
}

export function recruitmentContextFailure(
	context: RecruitmentDecisionContext,
	telegramUserId: string,
): { readonly ok: false; readonly code: ApplicationDecisionFailureCode } | undefined {
	if (context.actorStatus !== "active") return { ok: false, code: "actor_inactive" };
	if (
		context.actorTelegramUserId !== telegramUserId ||
		context.collaboration.authorTelegramUserId !== telegramUserId ||
		context.authorProfileId !== context.collaboration.authorProfileId
	) return { ok: false, code: "not_author" };
	if (
		!decisionTargetAvailable(context.collaboration) ||
		!Number.isSafeInteger(context.acceptedCount) || context.acceptedCount < 0
	) return { ok: false, code: "target_unavailable" };
	return undefined;
}

function decisionTargetAvailable(collaboration: ApplicationDecisionCollaboration): boolean {
	return collaboration.status === "published" && collaboration.syncBlocked !== true &&
		collaboration.publication.status === "published" &&
		TELEGRAM_CHAT_ID.test(collaboration.authorTelegramUserId) &&
		TELEGRAM_CHAT_ID.test(collaboration.publication.channelChatId) &&
		Number.isSafeInteger(collaboration.publication.messageId) && collaboration.publication.messageId > 0 &&
		Number.isSafeInteger(collaboration.slotsTotal) && collaboration.slotsTotal >= 1 && collaboration.slotsTotal <= 10 &&
		Number.isSafeInteger(collaboration.projectionRevision) && collaboration.projectionRevision >= 0 &&
		PUBLIC_TOKEN.test(collaboration.publicToken);
}

export function telegramContactUrl(identity: TelegramIdentitySnapshot | undefined): string | undefined {
	if (identity === undefined) return undefined;
	if (identity.username !== null && TELEGRAM_USERNAME.test(identity.username)) {
		return `https://t.me/${identity.username}`;
	}
	return TELEGRAM_USER_ID.test(identity.telegramUserId)
		? `tg://user?id=${identity.telegramUserId}`
		: undefined;
}

export function cardDeepLink(botUsername: string, publicToken: string): string | undefined {
	return TELEGRAM_BOT_USERNAME.test(botUsername) && PUBLIC_TOKEN.test(publicToken)
		? `https://t.me/${botUsername}?start=c_${publicToken}`
		: undefined;
}
