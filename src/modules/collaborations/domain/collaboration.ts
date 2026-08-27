import { formatInTimeZone } from "date-fns-tz";

import {
	DomainValidationError,
	parseCollaborationFormat,
	parseTargetProfileType,
	parseTopic,
	type CollaborationFormat,
	type CollaborationStatus,
	type TargetProfileType,
	type Topic,
} from "../../../domain/value-objects/enums.js";
import {
	deadlineAtEndOfLocalDay,
	formatEventDate,
	parseLocalDate,
	type LocalDate,
} from "./deadline.js";

export const COLLABORATION_CITY = "ekaterinburg" as const;
export const COLLABORATION_SESSION_VERSION = 1 as const;
export const COLLABORATION_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TELEGRAM_MESSAGE_UTF16_LENGTH = 4096;
const LOCAL_TIME_ZONE = "Asia/Yekaterinburg";

export interface CollaborationDraftInput {
	readonly format?: CollaborationFormat;
	readonly targetProfileType?: TargetProfileType;
	readonly topics?: readonly Topic[];
	readonly title?: string;
	readonly offerText?: string;
	readonly expectationText?: string;
	readonly slotsTotal?: number;
	readonly responseDeadlineAt?: number;
	readonly responseDeadlineDate?: string;
	readonly eventDateLocal?: string | null;
}

export interface CollaborationRecord {
	readonly id: string;
	readonly publicToken: string | null;
	readonly authorProfileId: string;
	readonly authorTelegramUserId: string;
	readonly format: CollaborationFormat | null;
	readonly targetProfileType: TargetProfileType | null;
	readonly topics: readonly Topic[];
	readonly title: string | null;
	readonly offerText: string | null;
	readonly expectationText: string | null;
	readonly slotsTotal: number | null;
	readonly responseDeadlineAt: number | null;
	readonly eventDateLocal: string | null;
	readonly cityCode: typeof COLLABORATION_CITY | null;
	readonly status: CollaborationStatus;
	readonly version: number;
	readonly projectionRevision: number;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export type CollaborationDraftState = CollaborationDraftInput & {
	readonly version: typeof COLLABORATION_SESSION_VERSION;
	readonly generation: string;
	readonly step: CollaborationWizardStep;
};

export type CollaborationWizardStep =
	| "format"
	| "target_profile_type"
	| "topics"
	| "title"
	| "offer"
	| "expectation"
	| "slots"
	| "deadline"
	| "event_date"
	| "preview";

type MutableCollaborationDraftInput = { -readonly [Key in keyof CollaborationDraftInput]?: CollaborationDraftInput[Key] };

export interface CollaborationValidationOptions {
	/** Allows a persisted deadline snapshot to remain navigable through the end of its local day. */
	readonly allowPersistedDeadline?: boolean;
}

export function validateCollaborationDraftInput(input: CollaborationDraftInput, nowMs: number, options: CollaborationValidationOptions = {}): CollaborationDraftInput {
	if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new DomainValidationError("collaboration clock returned an invalid timestamp");
	const normalized: MutableCollaborationDraftInput = {};
	if (input.format !== undefined) normalized.format = parseCollaborationFormat(input.format);
	if (input.targetProfileType !== undefined) normalized.targetProfileType = parseTargetProfileType(input.targetProfileType);
	if (input.topics !== undefined) {
		if (!Array.isArray(input.topics) || input.topics.length < 1 || input.topics.length > 3) throw new DomainValidationError("collaboration topics must contain between one and three values");
		const topics = input.topics.map((topic) => parseTopic(topic));
		if (new Set(topics).size !== topics.length) throw new DomainValidationError("collaboration topics must be unique");
		normalized.topics = topics;
	}
	if (input.title !== undefined) normalized.title = boundedText(input.title, 5, 100, "title");
	if (input.offerText !== undefined) normalized.offerText = boundedText(input.offerText, 10, 1000, "offer");
	if (input.expectationText !== undefined) normalized.expectationText = boundedText(input.expectationText, 10, 1000, "expectation");
	if (input.slotsTotal !== undefined) {
		if (!Number.isSafeInteger(input.slotsTotal) || input.slotsTotal < 1 || input.slotsTotal > 10) throw new DomainValidationError("collaboration slots must be between one and ten");
		normalized.slotsTotal = input.slotsTotal;
	}
	const deadlineDate = input.responseDeadlineDate;
	if (deadlineDate !== undefined) {
		const parsed = parseLocalDateOrDomainError(deadlineDate);
		const deadlineAt = deadlineAtEndOfLocalDay(parsed);
		const today = localDateFromMilliseconds(nowMs);
		const dayDelta = localDateOrdinal(parsed) - localDateOrdinal(today);
		const persistedSnapshot = options.allowPersistedDeadline === true && input.responseDeadlineAt === deadlineAt && nowMs <= deadlineAt;
		if ((!persistedSnapshot && dayDelta < 1) || dayDelta > 90) throw new DomainValidationError("response deadline must be a future date within 90 days");
		normalized.responseDeadlineDate = deadlineDate;
		normalized.responseDeadlineAt = deadlineAt;
	} else if (input.responseDeadlineAt !== undefined) {
		const persistedSnapshot = options.allowPersistedDeadline === true && nowMs <= input.responseDeadlineAt;
		if (!Number.isSafeInteger(input.responseDeadlineAt) || (!persistedSnapshot && input.responseDeadlineAt <= nowMs)) throw new DomainValidationError("response deadline must be in the future");
		normalized.responseDeadlineAt = input.responseDeadlineAt;
	}
	if (input.eventDateLocal === null) {
		normalized.eventDateLocal = null;
	} else if (input.eventDateLocal !== undefined) {
		const eventDate = parseLocalDateOrDomainError(input.eventDateLocal);
		if (normalized.responseDeadlineDate !== undefined && localDateOrdinal(eventDate) < localDateOrdinal(parseLocalDate(normalized.responseDeadlineDate))) {
			throw new DomainValidationError("event date cannot be before response deadline");
		}
			normalized.eventDateLocal = formatEventDate(eventDate);
	}
	return normalized;
}

export function validateCompleteCollaborationDraft(input: CollaborationDraftInput, nowMs: number, options: CollaborationValidationOptions = {}): Required<Pick<CollaborationDraftInput, "format" | "targetProfileType" | "topics" | "title" | "offerText" | "expectationText" | "slotsTotal" | "responseDeadlineAt" | "responseDeadlineDate">> & Pick<CollaborationDraftInput, "eventDateLocal"> {
	const normalized = validateCollaborationDraftInput(input, nowMs, options);
	if (normalized.format === undefined || normalized.targetProfileType === undefined || normalized.topics === undefined || normalized.title === undefined || normalized.offerText === undefined || normalized.expectationText === undefined || normalized.slotsTotal === undefined || normalized.responseDeadlineAt === undefined) {
		throw new DomainValidationError("collaboration draft is incomplete");
	}
	if (input.responseDeadlineDate === undefined) throw new DomainValidationError("response deadline date is required");
	return {
		format: normalized.format,
		targetProfileType: normalized.targetProfileType,
		topics: normalized.topics,
		title: normalized.title,
		offerText: normalized.offerText,
		expectationText: normalized.expectationText,
		slotsTotal: normalized.slotsTotal,
		responseDeadlineAt: normalized.responseDeadlineAt,
		responseDeadlineDate: normalized.responseDeadlineDate as string,
		...(normalized.eventDateLocal === undefined ? {} : { eventDateLocal: normalized.eventDateLocal }),
	};
}

export function localDateFromMilliseconds(milliseconds: number): LocalDate {
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new DomainValidationError("timestamp is invalid");
	const value = formatInTimeZone(new Date(milliseconds), LOCAL_TIME_ZONE, "dd.MM.yyyy");
	return parseLocalDate(value);
}

export function responseDeadlineDateFromMilliseconds(milliseconds: number): string {
	const date = localDateFromMilliseconds(milliseconds);
	return formatEventDate(date);
}

function parseLocalDateOrDomainError(value: string): LocalDate {
	try {
		return parseLocalDate(value);
	} catch {
		throw new DomainValidationError("date must use a valid DD.MM.YYYY value");
	}
}

function boundedText(value: string, min: number, max: number, field: string): string {
	const normalized = value.trim();
	if (normalized.length < min || normalized.length > max) throw new DomainValidationError(`${field} must contain between ${min} and ${max} characters`);
	return normalized;
}

function localDateOrdinal(date: LocalDate): number {
	return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}
