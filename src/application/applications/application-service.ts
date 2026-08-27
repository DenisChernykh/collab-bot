import { randomUUID } from "node:crypto";

import type { DeliveryEditPayload, DeliverySendPayload } from "../outbox/delivery-payload.js";
import { OutboxDeliveryService } from "../outbox/outbox-service.js";
import { assertTelegramTextFits, escapeHtml, renderCollaborationCard } from "../collaborations/collaboration-renderer.js";
import type { Clock } from "../ports/clock.js";
import type { OutboxDeliveryStore } from "../ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../ports/transaction-runner.js";
import type {
	CollaborationStatus,
	CollaborationFormat,
	ApplicationStatus,
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

export interface ApplicationDecisionStore extends ApplicationSubmissionStore {
	findDecisionContext(
		telegramUserId: string,
		applicationId: string,
	): Promise<ApplicationDecisionContext | undefined>;
	findRecruitmentContext(
		telegramUserId: string,
		collaborationId: string,
	): Promise<RecruitmentDecisionContext | undefined>;
	updateApplicationDecision(input: {
		readonly applicationId: string;
		readonly status: "accepted" | "rejected" | "closed";
		readonly decidedByProfileId: string | null;
		readonly decidedAt: number | null;
	}): Promise<boolean>;
	closePendingApplications(collaborationId: string): Promise<readonly ApplicationNotificationSnapshot[]>;
	listAcceptedApplications(collaborationId: string): Promise<readonly ApplicationNotificationSnapshot[]>;
	updateCollaborationDecision(input: {
		readonly collaborationId: string;
		readonly expectedProjectionRevision: number;
		readonly status: "published" | "matched";
		readonly matchedAt: number | null;
		readonly projectionRevision: number;
		readonly updatedAt: number;
	}): Promise<boolean>;
	supersedeOlderProjectionDeliveries(input: {
		readonly collaborationId: string;
		readonly beforeProjectionRevision: number;
		readonly updatedAt: number;
	}): Promise<number>;
	findPairContactContext(
		telegramUserId: string,
		applicationId: string,
	): Promise<PairContactContext | undefined>;
	findCurrentActionVersion(entityId: string): Promise<number | undefined>;
	listOwnApplications(telegramUserId: string): Promise<readonly OwnApplicationSummary[]>;
	findAuthorManagement(telegramUserId: string, collaborationId: string): Promise<AuthorManagementView | undefined>;
	findAuthorManagementByPublicToken(telegramUserId: string, publicToken: string): Promise<AuthorManagementView | undefined>;
	listAuthorManagement(telegramUserId: string): Promise<readonly AuthorManagementView[]>;
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

export class ApplicationService {
	private readonly outbox: OutboxDeliveryService;

	constructor(
		private readonly store: ApplicationDecisionStore,
		outboxStore: OutboxDeliveryStore,
		private readonly transactions: TransactionRunner,
		private readonly clock: Clock,
		private readonly botUsername: string,
	) {
		this.outbox = new OutboxDeliveryService(outboxStore, transactions, this.clock);
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

	async decide(input: ApplicationDecisionInput): Promise<ApplicationDecisionResult> {
		assertDecisionInput(input.telegramUserId, input.applicationId, input.occurredAt);
		try {
			return await this.transactions.withTransaction(async () => {
				const context = await this.store.findDecisionContext(input.telegramUserId, input.applicationId);
				if (context === undefined) return { ok: false, code: "target_unavailable" };
				const unavailable = decisionContextFailure(context, input.telegramUserId);
				if (unavailable !== undefined) return unavailable;
				if (context.application.status !== "pending") return { ok: false, code: "not_pending" };

				if (input.decision === "reject") {
					await this.requireApplicationUpdate({
						applicationId: context.application.id,
						status: "rejected",
						decidedByProfileId: context.authorProfileId,
						decidedAt: input.occurredAt,
					});
					const delivery = await this.outbox.createWithinTransaction({
						id: randomUUID(),
						idempotencyKey: `application:${context.application.id}:rejected:v1`,
						kind: "dm_send",
						recipientChatId: context.application.applicantTelegramUserId,
						payload: renderNeutralApplicationDm(
							"Отклик отклонён",
							context.collaboration.title,
							"Автор выбрал другого кандидата. Контактные данные не раскрываются.",
							cardDeepLink(this.botUsername, context.collaboration.publicToken),
						),
					});
					return {
						ok: true,
						applicationId: context.application.id,
						collaborationId: context.collaboration.id,
						applicationStatus: "rejected",
						collaborationStatus: "published",
						acceptedCount: context.acceptedCount,
						projectionRevision: context.collaboration.projectionRevision,
						deliveryIds: [delivery.id],
					};
				}

				if (context.applicantProfileStatus !== "active" || context.applicantActorStatus !== "active") {
					await this.requireApplicationUpdate({
						applicationId: context.application.id,
						status: "closed",
						decidedByProfileId: null,
						decidedAt: null,
					});
					await this.outbox.createWithinTransaction({
						id: randomUUID(),
						idempotencyKey: `application:${context.application.id}:closed:v1`,
						kind: "dm_send",
						recipientChatId: context.application.applicantTelegramUserId,
						payload: renderNeutralApplicationDm(
							"Отклик закрыт",
							context.collaboration.title,
							"Отклик больше недоступен. Контактные данные не раскрываются.",
							cardDeepLink(this.botUsername, context.collaboration.publicToken),
						),
					});
					return { ok: false, code: "applicant_unavailable" };
				}
				if (context.acceptedCount >= context.collaboration.slotsTotal) {
					return { ok: false, code: "slots_filled" };
				}

				await this.requireApplicationUpdate({
					applicationId: context.application.id,
					status: "accepted",
					decidedByProfileId: context.authorProfileId,
					decidedAt: input.occurredAt,
				});
				const acceptedCount = context.acceptedCount + 1;
				const matched = acceptedCount === context.collaboration.slotsTotal;
				const accepted = matched
					? await this.store.listAcceptedApplications(context.collaboration.id)
					: [];
				if (matched && (
					accepted.length !== acceptedCount ||
					accepted.some((item) => item.application.status !== "accepted")
				)) throw new Error("accepted application notification snapshot is corrupt");
				const closed = matched
					? await this.store.closePendingApplications(context.collaboration.id)
					: [];
				const projectionRevision = context.collaboration.projectionRevision + 1;
				await this.requireCollaborationUpdate({
					collaborationId: context.collaboration.id,
					expectedProjectionRevision: context.collaboration.projectionRevision,
					status: matched ? "matched" : "published",
					matchedAt: matched ? input.occurredAt : null,
					projectionRevision,
					updatedAt: input.occurredAt,
				});

				const deliveryIds: string[] = [];
				deliveryIds.push(...await this.createAcceptedPairDeliveries(context));
				if (matched) {
					for (const pair of accepted) {
						deliveryIds.push(...await this.createRecruitmentCompletedPairDeliveries(context, pair));
					}
				}
				deliveryIds.push(...await this.createClosedDeliveries(context.collaboration, closed));
				deliveryIds.push(await this.createProjectionDelivery(
					context.collaboration,
					matched ? "matched" : "published",
					acceptedCount,
					projectionRevision,
					input.occurredAt,
				));
				return {
					ok: true,
					applicationId: context.application.id,
					collaborationId: context.collaboration.id,
					applicationStatus: "accepted",
					collaborationStatus: matched ? "matched" : "published",
					acceptedCount,
					projectionRevision,
					deliveryIds,
				};
			});
		} catch (error) {
			if (error instanceof ApplicationDecisionConflictError) return { ok: false, code: "stale" };
			throw error;
		}
	}

	async completeRecruitment(input: CompleteRecruitmentInput): Promise<CompleteRecruitmentResult> {
		assertDecisionInput(input.telegramUserId, input.collaborationId, input.occurredAt);
		try {
			return await this.transactions.withTransaction(async () => {
				const context = await this.store.findRecruitmentContext(input.telegramUserId, input.collaborationId);
				if (context === undefined) return { ok: false, code: "target_unavailable" };
				const unavailable = recruitmentContextFailure(context, input.telegramUserId);
				if (unavailable !== undefined) return unavailable;
				if (context.acceptedCount < 1) return { ok: false, code: "no_accepted" };
				const accepted = await this.store.listAcceptedApplications(context.collaboration.id);
				if (accepted.length !== context.acceptedCount || accepted.some((item) => item.application.status !== "accepted")) {
					throw new Error("accepted application notification snapshot is corrupt");
				}
				const closed = await this.store.closePendingApplications(context.collaboration.id);
				const projectionRevision = context.collaboration.projectionRevision + 1;
				await this.requireCollaborationUpdate({
					collaborationId: context.collaboration.id,
					expectedProjectionRevision: context.collaboration.projectionRevision,
					status: "matched",
					matchedAt: input.occurredAt,
					projectionRevision,
					updatedAt: input.occurredAt,
				});

				const deliveryIds: string[] = [];
				for (const pair of accepted) {
					deliveryIds.push(...await this.createRecruitmentCompletedPairDeliveries(context, pair));
				}
				deliveryIds.push(...await this.createClosedDeliveries(context.collaboration, closed));
				deliveryIds.push(await this.createProjectionDelivery(
					context.collaboration,
					"matched",
					context.acceptedCount,
					projectionRevision,
					input.occurredAt,
				));
				return {
					ok: true,
					collaborationId: context.collaboration.id,
					collaborationStatus: "matched",
					acceptedCount: context.acceptedCount,
					projectionRevision,
					deliveryIds,
				};
			});
		} catch (error) {
			if (error instanceof ApplicationDecisionConflictError) return { ok: false, code: "stale" };
			throw error;
		}
	}

	async getPairContact(telegramUserId: string, applicationId: string): Promise<PairContactResult> {
		if (!TELEGRAM_USER_ID.test(telegramUserId) || !UUID.test(applicationId)) {
			return { ok: false, code: "contact_unavailable" };
		}
		return this.transactions.withTransaction(async () => {
			const context = await this.store.findPairContactContext(telegramUserId, applicationId);
			if (context === undefined) return { ok: false, code: "contact_unavailable" };
			if (!context.authorized) return { ok: false, code: context.reason };
			const url = telegramContactUrl(context.counterpartIdentity);
			return url === undefined
				? { ok: false, code: "contact_unavailable" }
				: { ok: true, url };
		});
	}

	async currentActionVersion(entityId: string): Promise<number | undefined> {
		if (!ACTION_ENTITY.test(entityId)) return undefined;
		const version = await this.transactions.withTransaction(() => this.store.findCurrentActionVersion(entityId));
		return Number.isSafeInteger(version) && (version as number) >= 0 ? version : undefined;
	}

	async listOwnApplications(telegramUserId: string): Promise<readonly OwnApplicationSummary[]> {
		if (!TELEGRAM_USER_ID.test(telegramUserId)) return [];
		const rows = await this.transactions.withTransaction(() => this.store.listOwnApplications(telegramUserId));
		return rows.map(sanitizeOwnApplication);
	}

	async getAuthorManagement(telegramUserId: string, collaborationId: string): Promise<AuthorManagementView | undefined> {
		if (!TELEGRAM_USER_ID.test(telegramUserId) || !UUID.test(collaborationId)) return undefined;
		const row = await this.transactions.withTransaction(() => this.store.findAuthorManagement(telegramUserId, collaborationId));
		return row === undefined ? undefined : sanitizeAuthorManagement(row);
	}

	async getAuthorManagementByPublicToken(telegramUserId: string, publicToken: string): Promise<AuthorManagementView | undefined> {
		if (!TELEGRAM_USER_ID.test(telegramUserId) || !PUBLIC_TOKEN.test(publicToken)) return undefined;
		const row = await this.transactions.withTransaction(() => this.store.findAuthorManagementByPublicToken(telegramUserId, publicToken));
		return row === undefined ? undefined : sanitizeAuthorManagement(row);
	}

	async listAuthorManagement(telegramUserId: string): Promise<readonly AuthorManagementView[]> {
		if (!TELEGRAM_USER_ID.test(telegramUserId)) return [];
		const rows = await this.transactions.withTransaction(() => this.store.listAuthorManagement(telegramUserId));
		return rows.map(sanitizeAuthorManagement);
	}

	private async requireApplicationUpdate(
		input: Parameters<ApplicationDecisionStore["updateApplicationDecision"]>[0],
	): Promise<void> {
		if (!await this.store.updateApplicationDecision(input)) throw new ApplicationDecisionConflictError();
	}

	private async requireCollaborationUpdate(
		input: Parameters<ApplicationDecisionStore["updateCollaborationDecision"]>[0],
	): Promise<void> {
		if (!await this.store.updateCollaborationDecision(input)) throw new ApplicationDecisionConflictError();
	}

	private async createAcceptedPairDeliveries(context: ApplicationDecisionContext): Promise<readonly string[]> {
		const author = await this.outbox.createWithinTransaction({
			id: randomUUID(),
			idempotencyKey: `application:${context.application.id}:accepted:author:v1`,
			kind: "dm_send",
			recipientChatId: context.collaboration.authorTelegramUserId,
			payload: renderContactApplicationDm(
				"Отклик принят",
				context.collaboration.title,
				"Кандидат принят. Теперь вы можете написать друг другу в Telegram.",
				telegramContactUrl(context.applicantIdentity),
			),
		});
		const applicant = await this.outbox.createWithinTransaction({
			id: randomUUID(),
			idempotencyKey: `application:${context.application.id}:accepted:applicant:v1`,
			kind: "dm_send",
			recipientChatId: context.application.applicantTelegramUserId,
			payload: renderContactApplicationDm(
				"Отклик принят",
				context.collaboration.title,
				"Автор принял ваш отклик. Теперь вы можете написать друг другу в Telegram.",
				telegramContactUrl(context.authorIdentity),
			),
		});
		return [author.id, applicant.id];
	}

	private async createRecruitmentCompletedPairDeliveries(
		context: RecruitmentDecisionContext,
		pair: ApplicationNotificationSnapshot,
	): Promise<readonly string[]> {
		const author = await this.outbox.createWithinTransaction({
			id: randomUUID(),
			idempotencyKey: `collaboration:${context.collaboration.id}:matched:author:${pair.application.id}:v1`,
			kind: "dm_send",
			recipientChatId: context.collaboration.authorTelegramUserId,
			payload: renderContactApplicationDm(
				"Набор завершён",
				context.collaboration.title,
				"Договоритесь с принятым партнёром о следующем шаге.",
				telegramContactUrl(pair.applicantIdentity),
			),
		});
		const applicant = await this.outbox.createWithinTransaction({
			id: randomUUID(),
			idempotencyKey: `collaboration:${context.collaboration.id}:matched:applicant:${pair.application.id}:v1`,
			kind: "dm_send",
			recipientChatId: pair.application.applicantTelegramUserId,
			payload: renderContactApplicationDm(
				"Набор завершён",
				context.collaboration.title,
				"Автор завершил набор. Договоритесь о следующем шаге.",
				telegramContactUrl(context.authorIdentity),
			),
		});
		return [author.id, applicant.id];
	}

	private async createClosedDeliveries(
		collaboration: ApplicationDecisionCollaboration,
		closed: readonly ApplicationNotificationSnapshot[],
	): Promise<readonly string[]> {
		const ids: string[] = [];
		for (const item of closed) {
			const delivery = await this.outbox.createWithinTransaction({
				id: randomUUID(),
				idempotencyKey: `application:${item.application.id}:closed:v1`,
				kind: "dm_send",
				recipientChatId: item.application.applicantTelegramUserId,
				payload: renderNeutralApplicationDm(
					"Отклик закрыт",
					collaboration.title,
					"Причина: набор завершён.",
					cardDeepLink(this.botUsername, collaboration.publicToken),
				),
			});
			ids.push(delivery.id);
		}
		return ids;
	}

	private async createProjectionDelivery(
		collaboration: ApplicationDecisionCollaboration,
		status: "published" | "matched",
		acceptedCount: number,
		projectionRevision: number,
		occurredAt: number,
	): Promise<string> {
		await this.store.supersedeOlderProjectionDeliveries({
			collaborationId: collaboration.id,
			beforeProjectionRevision: projectionRevision,
			updatedAt: Math.max(occurredAt, this.clock.now().getTime()),
		});
		const delivery = await this.outbox.createWithinTransaction({
			id: randomUUID(),
			idempotencyKey: `channel:${collaboration.id}:projection:${projectionRevision}`,
			kind: "channel_edit",
			recipientChatId: collaboration.publication.channelChatId,
			messageId: collaboration.publication.messageId,
			payload: renderDecisionProjection(collaboration, status, acceptedCount, this.botUsername),
		});
		return delivery.id;
	}
}

class ApplicationDecisionConflictError extends Error {}

function decisionContextFailure(
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

function recruitmentContextFailure(
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

function renderNeutralApplicationDm(
	heading: string,
	collaborationTitle: string,
	message: string,
	cardUrl: string | undefined,
): DeliverySendPayload {
	const text = [heading, "", `Карточка: ${escapeHtml(collaborationTitle)}`, message].join("\n");
	assertTelegramTextFits(text);
	return {
		version: 1,
		method: "send",
		text,
		...(cardUrl === undefined ? {} : {
			replyMarkup: { inline_keyboard: [[{ text: "Открыть карточку", url: cardUrl }]] },
		}),
	};
}

function renderContactApplicationDm(
	heading: string,
	collaborationTitle: string,
	message: string,
	contactUrl: string | undefined,
): DeliverySendPayload {
	const text = [heading, "", `Карточка: ${escapeHtml(collaborationTitle)}`, message].join("\n");
	assertTelegramTextFits(text);
	return {
		version: 1,
		method: "send",
		text,
		...(contactUrl === undefined ? {} : {
			replyMarkup: { inline_keyboard: [[{ text: "Написать в Telegram", url: contactUrl }]] },
		}),
	};
}

function renderDecisionProjection(
	collaboration: ApplicationDecisionCollaboration,
	status: "published" | "matched",
	acceptedCount: number,
	botUsername: string,
): DeliveryEditPayload {
	const base = renderCollaborationCard({
		format: collaboration.format,
		targetProfileType: collaboration.targetProfileType,
		topics: collaboration.topics,
		title: collaboration.title,
		offerText: collaboration.offerText,
		expectationText: collaboration.expectationText,
		slotsTotal: collaboration.slotsTotal,
		responseDeadlineAt: collaboration.responseDeadlineAt,
		eventDateLocal: collaboration.eventDateLocal,
	});
	const remaining = Math.max(0, collaboration.slotsTotal - acceptedCount);
	const text = `${base}\n\n${status === "matched" ? "<b>Набор завершён</b>" : `<b>Осталось мест: ${remaining}</b>`}`;
	assertTelegramTextFits(text);
	const cardUrl = cardDeepLink(botUsername, collaboration.publicToken);
	return {
		version: 1,
		method: "edit",
		text,
		...(cardUrl === undefined ? { replyMarkup: { inline_keyboard: [] } } : {
			replyMarkup: { inline_keyboard: [[{ text: "Открыть в боте", url: cardUrl }]] },
		}),
	};
}

function telegramContactUrl(identity: TelegramIdentitySnapshot | undefined): string | undefined {
	if (identity === undefined) return undefined;
	if (identity.username !== null && TELEGRAM_USERNAME.test(identity.username)) {
		return `https://t.me/${identity.username}`;
	}
	return TELEGRAM_USER_ID.test(identity.telegramUserId)
		? `tg://user?id=${identity.telegramUserId}`
		: undefined;
}

function cardDeepLink(botUsername: string, publicToken: string): string | undefined {
	return TELEGRAM_BOT_USERNAME.test(botUsername) && PUBLIC_TOKEN.test(publicToken)
		? `https://t.me/${botUsername}?start=c_${publicToken}`
		: undefined;
}

function sanitizeOwnApplication(value: OwnApplicationSummary): OwnApplicationSummary {
	return {
		applicationId: value.applicationId,
		collaborationId: value.collaborationId,
		collaborationTitle: value.collaborationTitle,
		collaborationStatus: value.collaborationStatus,
		status: value.status,
		createdAt: value.createdAt,
	};
}

function sanitizeAuthorManagement(value: AuthorManagementView): AuthorManagementView {
	return {
		collaborationId: value.collaborationId,
		publicToken: value.publicToken,
		title: value.title,
		status: value.status,
		slotsTotal: value.slotsTotal,
		acceptedCount: value.acceptedCount,
		projectionRevision: value.projectionRevision,
		applications: value.applications.map((application) => ({
			applicationId: application.applicationId,
			message: application.message,
			status: application.status,
			createdAt: application.createdAt,
			applicant: sanitizePublicApplicant(application.applicant),
		})),
	};
}

function sanitizePublicApplicant(value: PublicApplicantSnapshot): PublicApplicantSnapshot {
	return {
		type: value.type,
		displayName: value.displayName,
		description: value.description,
		topics: [...value.topics],
		platform: {
			platformType: value.platform.platformType,
			url: value.platform.url,
			title: value.platform.title,
			audienceSize: value.platform.audienceSize,
		},
	};
}

function assertDecisionInput(telegramUserId: string, entityId: string, occurredAt: number): void {
	if (!TELEGRAM_USER_ID.test(telegramUserId) || !UUID.test(entityId) || !Number.isSafeInteger(occurredAt) || occurredAt < 0) {
		throw new RangeError("application decision input is invalid");
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
const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const TELEGRAM_USER_ID = /^[1-9][0-9]{0,19}$/;
const TELEGRAM_CHAT_ID = /^-?[1-9][0-9]{0,19}$/;
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const TELEGRAM_BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/;
const ACTION_ENTITY = /^(?:application|collaboration):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
