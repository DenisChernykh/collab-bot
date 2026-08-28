export const PROFILE_TYPES = [
	"blogger",
	"telegram_channel",
	"venue_or_brand",
] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export const COLLABORATION_FORMATS = [
	"advertising_integration",
	"barter",
	"joint_giveaway",
	"joint_content",
	"mutual_pr",
	"event",
	"other",
] as const;
export type CollaborationFormat = (typeof COLLABORATION_FORMATS)[number];

export const TARGET_PROFILE_TYPES = [
	"blogger",
	"telegram_channel",
	"venue_or_brand",
	"any",
] as const;
export type TargetProfileType = (typeof TARGET_PROFILE_TYPES)[number];

export const TOPICS = [
	"lifestyle",
	"food",
	"beauty",
	"travel",
	"city",
	"events",
	"family",
	"sport",
	"business",
	"other",
] as const;
export type Topic = (typeof TOPICS)[number];

export const PLATFORM_TYPES = [
	"telegram",
	"instagram",
	"vk",
	"tiktok",
	"youtube",
	"website",
	"other",
] as const;
export type PlatformType = (typeof PLATFORM_TYPES)[number];

export const COLLABORATION_STATUSES = [
	"draft",
	"publishing",
	"published",
	"publication_failed",
	"matched",
	"completed",
	"cancelled",
	"expired",
	"hidden",
] as const;
export type CollaborationStatus = (typeof COLLABORATION_STATUSES)[number];

export const APPLICATION_STATUSES = [
	"pending",
	"accepted",
	"rejected",
	"withdrawn",
	"closed",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const COMPLETION_RESULTS = ["happened", "did_not_happen"] as const;
export type CompletionResult = (typeof COMPLETION_RESULTS)[number];

export class DomainValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DomainValidationError";
	}
}

function isEnumValue<T extends string>(value: unknown, values: readonly T[]): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function parseEnum<T extends string>(value: unknown, values: readonly T[], name: string): T {
	if (!isEnumValue(value, values)) {
		throw new DomainValidationError(`${name} contains an unsupported value`);
	}
	return value;
}

export const isProfileType = (value: unknown): value is ProfileType => isEnumValue(value, PROFILE_TYPES);
export const isCollaborationFormat = (value: unknown): value is CollaborationFormat =>
	isEnumValue(value, COLLABORATION_FORMATS);
export const isTargetProfileType = (value: unknown): value is TargetProfileType =>
	isEnumValue(value, TARGET_PROFILE_TYPES);
export const isTopic = (value: unknown): value is Topic => isEnumValue(value, TOPICS);
export const isPlatformType = (value: unknown): value is PlatformType => isEnumValue(value, PLATFORM_TYPES);
export const isCollaborationStatus = (value: unknown): value is CollaborationStatus =>
	isEnumValue(value, COLLABORATION_STATUSES);
export const isApplicationStatus = (value: unknown): value is ApplicationStatus =>
	isEnumValue(value, APPLICATION_STATUSES);
export const isCompletionResult = (value: unknown): value is CompletionResult =>
	isEnumValue(value, COMPLETION_RESULTS);

export const parseProfileType = (value: unknown): ProfileType =>
	parseEnum(value, PROFILE_TYPES, "ProfileType");
export const parseCollaborationFormat = (value: unknown): CollaborationFormat =>
	parseEnum(value, COLLABORATION_FORMATS, "CollaborationFormat");
export const parseTargetProfileType = (value: unknown): TargetProfileType =>
	parseEnum(value, TARGET_PROFILE_TYPES, "TargetProfileType");
export const parseTopic = (value: unknown): Topic => parseEnum(value, TOPICS, "Topic");
export const parsePlatformType = (value: unknown): PlatformType =>
	parseEnum(value, PLATFORM_TYPES, "PlatformType");
export const parseCollaborationStatus = (value: unknown): CollaborationStatus =>
	parseEnum(value, COLLABORATION_STATUSES, "CollaborationStatus");
export const parseApplicationStatus = (value: unknown): ApplicationStatus =>
	parseEnum(value, APPLICATION_STATUSES, "ApplicationStatus");
export const parseCompletionResult = (value: unknown): CompletionResult =>
	parseEnum(value, COMPLETION_RESULTS, "CompletionResult");
