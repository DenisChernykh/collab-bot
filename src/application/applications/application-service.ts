import { randomUUID } from "node:crypto";

import type { DeliverySendPayload } from "../outbox/delivery-payload.js";
import { OutboxDeliveryService } from "../outbox/outbox-service.js";
import type { Clock } from "../ports/clock.js";
import type { OutboxDeliveryStore } from "../ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../ports/transaction-runner.js";
import type {
	CollaborationStatus,
	PlatformType,
	ProfileType,
	TargetProfileType,
	Topic,
} from "../../domain/value-objects/enums.js";

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

export interface ApplicationSubmissionStore {
	findSubmissionContext(
		telegramUserId: string,
		collaborationId: string,
	): Promise<ApplicationSubmissionContext | undefined>;
	insertPending(record: ApplicationRecord): Promise<void>;
	setFirstApplicationAt(collaborationId: string, firstApplicationAt: number): Promise<boolean>;
}

export interface ApplicationEligibilityInput {
	readonly telegramUserId: string;
	readonly collaborationId: string;
	readonly occurredAt: number;
}

export interface ApplicationSubmitInput extends ApplicationEligibilityInput {
	readonly message: string;
}

export class ApplicationService {
	private readonly outbox: OutboxDeliveryService;

	constructor(
		private readonly store: ApplicationSubmissionStore,
		outboxStore: OutboxDeliveryStore,
		private readonly transactions: TransactionRunner,
		clock: Clock,
		private readonly botUsername: string,
	) {
		this.outbox = new OutboxDeliveryService(outboxStore, transactions, clock);
	}

	checkEligibility(input: ApplicationEligibilityInput): Promise<ApplicationEligibility> {
		assertEligibilityInput(input);
		return this.transactions.withTransaction(async () => {
			const context = await this.store.findSubmissionContext(input.telegramUserId, input.collaborationId);
			return evaluateEligibility(context, input.telegramUserId, input.occurredAt);
		});
	}

	async submit(input: ApplicationSubmitInput): Promise<ApplicationSubmitResult> {
		assertEligibilityInput(input);
		const normalized = normalizeApplicationMessage(input.message);
		if (!normalized.ok) return normalized;
		return this.transactions.withTransaction(async () => {
			const context = await this.store.findSubmissionContext(input.telegramUserId, input.collaborationId);
			const eligibility = evaluateEligibility(context, input.telegramUserId, input.occurredAt);
			if (!eligibility.ok) return eligibility;

			const application: ApplicationRecord = {
				id: randomUUID(),
				collaborationId: eligibility.target.collaborationId,
				applicantProfileId: eligibility.applicant.profileId,
				message: normalized.value,
				termsVersion: APPLICATION_TERMS_VERSION,
				collaborationVersion: eligibility.target.version,
				status: "pending",
				decidedByProfileId: null,
				createdAt: input.occurredAt,
				decidedAt: null,
			};
			await this.store.insertPending(application);
			await this.store.setFirstApplicationAt(application.collaborationId, application.createdAt);
			const delivery = await this.outbox.createWithinTransaction({
				id: randomUUID(),
				idempotencyKey: `application:${application.id}:author_dm:v1`,
				kind: "dm_send",
				recipientChatId: eligibility.target.authorTelegramUserId,
				payload: renderApplicationAuthorDm({
					collaborationTitle: eligibility.target.title ?? "Коллаборация",
					applicationMessage: application.message,
					applicant: eligibility.applicant,
					managementUrl: `https://t.me/${this.botUsername}?start=c_${eligibility.target.publicToken}`,
				}),
			});
			return {
				ok: true,
				applicationId: application.id,
				deliveryId: delivery.id,
				application,
			};
		});
	}
}

export function normalizeApplicationMessage(
	raw: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly code: "invalid_message" } {
	if (typeof raw !== "string" || raw.includes("\u0000")) return { ok: false, code: "invalid_message" };
	const value = raw.trim();
	return value.length >= 10 && value.length <= 500
		? { ok: true, value }
		: { ok: false, code: "invalid_message" };
}

export function renderApplicationAuthorDm(input: {
	readonly collaborationTitle: string;
	readonly applicationMessage: string;
	readonly applicant: PublicApplicantSnapshot;
	readonly managementUrl: string;
}): DeliverySendPayload {
	const applicant = input.applicant;
	const lines = [
		"Новый отклик на коллаборацию",
		"",
		`Карточка: ${input.collaborationTitle}`,
		`Кандидат: ${applicant.displayName}`,
		`Тип: ${profileTypeLabel(applicant.type)}`,
		...(applicant.description === null ? [] : [`Описание: ${applicant.description}`]),
		...(applicant.topics.length === 0 ? [] : [`Темы: ${applicant.topics.map(topicLabel).join(", ")}`]),
		`Площадка: ${applicant.platform.title === null ? applicant.platform.url : `${applicant.platform.title} — ${applicant.platform.url}`}`,
		...(applicant.platform.audienceSize === null ? [] : [`Аудитория: ${applicant.platform.audienceSize}`]),
		"",
		"Сообщение кандидата:",
		input.applicationMessage,
	];
	return {
		version: 1,
		method: "send",
		text: lines.join("\n"),
		replyMarkup: { inline_keyboard: [[{ text: "Открыть карточку", url: input.managementUrl }]] },
	};
}

function evaluateEligibility(
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

function assertEligibilityInput(input: ApplicationEligibilityInput): void {
	if (!/^\d+$/.test(input.telegramUserId) || !UUID.test(input.collaborationId) || !Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) {
		throw new RangeError("application eligibility input is invalid");
	}
}

function profileTypeLabel(value: ProfileType): string {
	return ({ blogger: "Блогер", telegram_channel: "Telegram-канал", venue_or_brand: "Заведение или бренд" } as const)[value];
}

function topicLabel(value: Topic): string {
	return ({ lifestyle: "Lifestyle", food: "Еда и рестораны", beauty: "Красота", travel: "Путешествия", city: "Город", events: "События", family: "Семья", sport: "Спорт", business: "Бизнес", other: "Другое" } as const)[value];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
