import type {
	ApplicationStatus,
	CollaborationFormat,
	CollaborationStatus,
	PlatformType,
	ProfileType,
	TargetProfileType,
	Topic,
} from "../../../domain/value-objects/enums.js";

export const APPLICATION_TERMS_VERSION = 1 as const;

export type ApplicationFailureCode =
	| "invalid_message"
	| "actor_inactive"
	| "profile_required"
	| "target_unavailable"
	| "own_collaboration"
	| "profile_type_mismatch"
	| "deadline_passed"
	| "duplicate"
	| "full";

export type ApplicationEligibility =
	| {
		readonly ok: true;
		readonly applicant: ApplicantSnapshot;
		readonly target: ApplicationTarget;
	}
	| { readonly ok: false; readonly code: ApplicationFailureCode };

export type ApplicationSubmitResult =
	| {
		readonly ok: true;
		readonly applicationId: string;
		readonly deliveryId: string;
		readonly application: ApplicationRecord;
	}
	| { readonly ok: false; readonly code: ApplicationFailureCode };

export interface PublicApplicantPlatformSnapshot {
	readonly platformType: PlatformType;
	readonly url: string;
	readonly title: string | null;
	readonly audienceSize: number | null;
}

/** Deliberately excludes Telegram identity, internal IDs and timestamps. */
export interface PublicApplicantSnapshot {
	readonly type: ProfileType;
	readonly displayName: string;
	readonly description: string | null;
	readonly topics: readonly Topic[];
	readonly platform: PublicApplicantPlatformSnapshot;
}

export interface ApplicantSnapshot extends PublicApplicantSnapshot {
	readonly profileId: string;
}

export interface ApplicationTarget {
	readonly collaborationId: string;
	readonly publicToken: string | null;
	readonly authorProfileId: string;
	readonly authorTelegramUserId: string;
	readonly authorProfileStatus: "active" | "archived";
	readonly authorActorStatus: "active" | "blocked";
	readonly title: string | null;
	readonly status: CollaborationStatus;
	readonly version: number;
	readonly targetProfileType: TargetProfileType | null;
	readonly slotsTotal: number | null;
	readonly responseDeadlineAt: number | null;
	readonly publishedAt: number | null;
	readonly publicationStatus: string | null;
	readonly publicationMessageId: number | null;
}

export interface ApplicationSubmissionContext {
	readonly actorStatus: "active" | "blocked";
	readonly applicant: ApplicantSnapshot | null;
	readonly target: ApplicationTarget | null;
	readonly existingApplicationId: string | null;
	readonly acceptedCount: number;
}

export interface ApplicationRecord {
	readonly id: string;
	readonly collaborationId: string;
	readonly applicantProfileId: string;
	readonly message: string;
	readonly termsVersion: typeof APPLICATION_TERMS_VERSION;
	readonly collaborationVersion: number;
	readonly status: "pending";
	readonly decidedByProfileId: null;
	readonly createdAt: number;
	readonly decidedAt: null;
}

export interface TelegramIdentitySnapshot {
	readonly telegramUserId: string;
	readonly username: string | null;
}

export interface ApplicationDecisionRecord {
	readonly id: string;
	readonly collaborationId: string;
	readonly applicantProfileId: string;
	readonly applicantTelegramUserId: string;
	readonly message: string;
	readonly status: ApplicationStatus;
	readonly decidedByProfileId: string | null;
	readonly decidedAt: number | null;
	readonly createdAt: number;
}

export interface ApplicationDecisionCollaboration {
	readonly id: string;
	readonly publicToken: string;
	readonly authorProfileId: string;
	readonly authorTelegramUserId: string;
	readonly title: string;
	readonly format: CollaborationFormat;
	readonly targetProfileType: TargetProfileType;
	readonly topics: readonly Topic[];
	readonly offerText: string;
	readonly expectationText: string;
	readonly slotsTotal: number;
	readonly responseDeadlineAt: number;
	readonly eventDateLocal: string | null;
	readonly cityCode: "ekaterinburg";
	readonly status: CollaborationStatus;
	readonly version: number;
	readonly projectionRevision: number;
	readonly publishedAt: number;
	readonly matchedAt: number | null;
	readonly updatedAt: number;
	readonly publication: {
		readonly status: string;
		readonly channelChatId: string;
		readonly messageId: number;
	};
	/** True while a terms revision or a publication reconciliation fence blocks decisions. */
	readonly syncBlocked?: boolean;
}

export interface ApplicationDecisionContext {
	readonly actorStatus: "active" | "blocked";
	readonly actorTelegramUserId: string;
	readonly authorProfileId: string;
	readonly authorIdentity: TelegramIdentitySnapshot | undefined;
	readonly applicantProfileStatus: "active" | "archived";
	readonly applicantActorStatus: "active" | "blocked";
	readonly applicantIdentity: TelegramIdentitySnapshot | undefined;
	readonly application: ApplicationDecisionRecord;
	readonly collaboration: ApplicationDecisionCollaboration;
	readonly acceptedCount: number;
}

export interface ApplicationNotificationSnapshot {
	readonly application: ApplicationDecisionRecord;
	readonly applicantIdentity: TelegramIdentitySnapshot | undefined;
}

export interface RecruitmentDecisionContext {
	readonly actorStatus: "active" | "blocked";
	readonly actorTelegramUserId: string;
	readonly authorProfileId: string;
	readonly authorIdentity: TelegramIdentitySnapshot | undefined;
	readonly collaboration: ApplicationDecisionCollaboration;
	readonly acceptedCount: number;
}

export type PairContactContext =
	| { readonly authorized: true; readonly counterpartIdentity: TelegramIdentitySnapshot | undefined }
	| { readonly authorized: false; readonly reason: "not_accepted" | "not_pair" };

export interface OwnApplicationSummary {
	readonly applicationId: string;
	readonly collaborationId: string;
	readonly collaborationTitle: string | null;
	readonly collaborationStatus: CollaborationStatus;
	readonly status: ApplicationStatus;
	readonly createdAt: number;
}

export interface AuthorApplicationSummary {
	readonly applicationId: string;
	readonly message: string;
	readonly status: ApplicationStatus;
	readonly createdAt: number;
	readonly applicant: PublicApplicantSnapshot;
}

export interface AuthorManagementView {
	readonly collaborationId: string;
	readonly publicToken: string;
	readonly title: string | null;
	readonly status: CollaborationStatus;
	readonly slotsTotal: number;
	readonly acceptedCount: number;
	readonly projectionRevision: number;
	readonly applications: readonly AuthorApplicationSummary[];
}

export type ApplicationDecisionFailureCode =
	| "actor_inactive"
	| "not_author"
	| "target_unavailable"
	| "not_pending"
	| "applicant_unavailable"
	| "slots_filled"
	| "no_accepted"
	| "stale";

export type ApplicationDecisionResult =
	| {
		readonly ok: true;
		readonly applicationId: string;
		readonly collaborationId: string;
		readonly applicationStatus: "accepted" | "rejected";
		readonly collaborationStatus: "published" | "matched";
		readonly acceptedCount: number;
		readonly projectionRevision: number;
		readonly deliveryIds: readonly string[];
	}
	| { readonly ok: false; readonly code: ApplicationDecisionFailureCode };

export type CompleteRecruitmentResult =
	| {
		readonly ok: true;
		readonly collaborationId: string;
		readonly collaborationStatus: "matched";
		readonly acceptedCount: number;
		readonly projectionRevision: number;
		readonly deliveryIds: readonly string[];
	}
	| { readonly ok: false; readonly code: ApplicationDecisionFailureCode };

export type PairContactResult =
	| { readonly ok: true; readonly url: string }
	| { readonly ok: false; readonly code: "not_accepted" | "not_pair" | "contact_unavailable" };

export interface ApplicationDecisionInput {
	readonly telegramUserId: string;
	readonly applicationId: string;
	readonly decision: "accept" | "reject";
	readonly occurredAt: number;
}

export interface CompleteRecruitmentInput {
	readonly telegramUserId: string;
	readonly collaborationId: string;
	readonly occurredAt: number;
}

export interface ApplicationEligibilityInput {
	readonly telegramUserId: string;
	readonly collaborationId: string;
	readonly occurredAt: number;
}

export interface ApplicationSubmitInput extends ApplicationEligibilityInput {
	readonly message: string;
}
