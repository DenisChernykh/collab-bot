import { randomUUID } from "node:crypto";

import { assertTelegramTextFits, escapeHtml, renderCollaborationCard } from "../../collaborations/application/index.js";
import type { DeliveryEditPayload, DeliverySendPayload } from "../../../shared/application/outbox/delivery-payload.js";
import { OutboxDeliveryService } from "../../../shared/application/outbox/outbox-service.js";
import type { Clock } from "../../../shared/application/ports/clock.js";
import type { OutboxDeliveryStore } from "../../../shared/application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type {
	ApplicationDecisionCollaboration,
	ApplicationDecisionContext,
	ApplicationDecisionInput,
	ApplicationDecisionResult,
	ApplicationNotificationSnapshot,
	CompleteRecruitmentInput,
	CompleteRecruitmentResult,
	RecruitmentDecisionContext,
} from "./application-contracts.js";
import {
	assertDecisionInput,
	cardDeepLink,
	decisionContextFailure,
	recruitmentContextFailure,
	telegramContactUrl,
} from "./application-policy.js";

interface RecruitmentDecisionMutationStore {
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
}

export interface DecideApplicationStore extends RecruitmentDecisionMutationStore {
	findDecisionContext(
		telegramUserId: string,
		applicationId: string,
	): Promise<ApplicationDecisionContext | undefined>;
	updateApplicationDecision(input: {
		readonly applicationId: string;
		readonly status: "accepted" | "rejected" | "closed";
		readonly decidedByProfileId: string | null;
		readonly decidedAt: number | null;
	}): Promise<boolean>;
}

export interface CompleteRecruitmentStore extends RecruitmentDecisionMutationStore {
	findRecruitmentContext(
		telegramUserId: string,
		collaborationId: string,
	): Promise<RecruitmentDecisionContext | undefined>;
}

export class DecideApplicationUseCase {
	private readonly outbox: OutboxDeliveryService;

	constructor(
		private readonly store: DecideApplicationStore,
		outboxStore: OutboxDeliveryStore,
		private readonly transactions: TransactionRunner,
		private readonly clock: Clock,
		private readonly botUsername: string,
	) {
		this.outbox = new OutboxDeliveryService(outboxStore, transactions, clock);
	}

	async execute(input: ApplicationDecisionInput): Promise<ApplicationDecisionResult> {
		assertDecisionInput(input.telegramUserId, input.applicationId, input.occurredAt);
		try {
			return await this.transactions.withTransaction(async () => {
				const context = await this.store.findDecisionContext(input.telegramUserId, input.applicationId);
				if (context === undefined) return { ok: false, code: "target_unavailable" };
				const unavailable = decisionContextFailure(context, input.telegramUserId);
				if (unavailable !== undefined) return unavailable;
				if (context.application.status !== "pending") return { ok: false, code: "not_pending" };

				if (input.decision === "reject") {
					await requireApplicationUpdate(this.store, {
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
					await requireApplicationUpdate(this.store, {
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

				await requireApplicationUpdate(this.store, {
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
				await requireCollaborationUpdate(this.store, {
					collaborationId: context.collaboration.id,
					expectedProjectionRevision: context.collaboration.projectionRevision,
					status: matched ? "matched" : "published",
					matchedAt: matched ? input.occurredAt : null,
					projectionRevision,
					updatedAt: input.occurredAt,
				});

				const deliveryIds: string[] = [];
				deliveryIds.push(...await createAcceptedPairDeliveries(this.outbox, context));
				if (matched) {
					for (const pair of accepted) {
						deliveryIds.push(...await createRecruitmentCompletedPairDeliveries(this.outbox, context, pair));
					}
				}
				deliveryIds.push(...await createClosedDeliveries(
					this.outbox,
					this.botUsername,
					context.collaboration,
					closed,
				));
				deliveryIds.push(await createProjectionDelivery(
					this.store,
					this.outbox,
					this.clock,
					this.botUsername,
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
}

export class CompleteRecruitmentUseCase {
	private readonly outbox: OutboxDeliveryService;

	constructor(
		private readonly store: CompleteRecruitmentStore,
		outboxStore: OutboxDeliveryStore,
		private readonly transactions: TransactionRunner,
		private readonly clock: Clock,
		private readonly botUsername: string,
	) {
		this.outbox = new OutboxDeliveryService(outboxStore, transactions, clock);
	}

	async execute(input: CompleteRecruitmentInput): Promise<CompleteRecruitmentResult> {
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
				await requireCollaborationUpdate(this.store, {
					collaborationId: context.collaboration.id,
					expectedProjectionRevision: context.collaboration.projectionRevision,
					status: "matched",
					matchedAt: input.occurredAt,
					projectionRevision,
					updatedAt: input.occurredAt,
				});

				const deliveryIds: string[] = [];
				for (const pair of accepted) {
					deliveryIds.push(...await createRecruitmentCompletedPairDeliveries(this.outbox, context, pair));
				}
				deliveryIds.push(...await createClosedDeliveries(
					this.outbox,
					this.botUsername,
					context.collaboration,
					closed,
				));
				deliveryIds.push(await createProjectionDelivery(
					this.store,
					this.outbox,
					this.clock,
					this.botUsername,
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
}

class ApplicationDecisionConflictError extends Error {}

async function requireApplicationUpdate(
	store: DecideApplicationStore,
	input: Parameters<DecideApplicationStore["updateApplicationDecision"]>[0],
): Promise<void> {
	if (!await store.updateApplicationDecision(input)) throw new ApplicationDecisionConflictError();
}

async function requireCollaborationUpdate(
	store: RecruitmentDecisionMutationStore,
	input: Parameters<RecruitmentDecisionMutationStore["updateCollaborationDecision"]>[0],
): Promise<void> {
	if (!await store.updateCollaborationDecision(input)) throw new ApplicationDecisionConflictError();
}

async function createAcceptedPairDeliveries(
	outbox: OutboxDeliveryService,
	context: ApplicationDecisionContext,
): Promise<readonly string[]> {
	const author = await outbox.createWithinTransaction({
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
	const applicant = await outbox.createWithinTransaction({
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

async function createRecruitmentCompletedPairDeliveries(
	outbox: OutboxDeliveryService,
	context: Pick<ApplicationDecisionContext, "collaboration" | "authorIdentity"> | RecruitmentDecisionContext,
	pair: ApplicationNotificationSnapshot,
): Promise<readonly string[]> {
	const author = await outbox.createWithinTransaction({
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
	const applicant = await outbox.createWithinTransaction({
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

async function createClosedDeliveries(
	outbox: OutboxDeliveryService,
	botUsername: string,
	collaboration: ApplicationDecisionCollaboration,
	closed: readonly ApplicationNotificationSnapshot[],
): Promise<readonly string[]> {
	const ids: string[] = [];
	for (const item of closed) {
		const delivery = await outbox.createWithinTransaction({
			id: randomUUID(),
			idempotencyKey: `application:${item.application.id}:closed:v1`,
			kind: "dm_send",
			recipientChatId: item.application.applicantTelegramUserId,
			payload: renderNeutralApplicationDm(
				"Отклик закрыт",
				collaboration.title,
				"Причина: набор завершён.",
				cardDeepLink(botUsername, collaboration.publicToken),
			),
		});
		ids.push(delivery.id);
	}
	return ids;
}

async function createProjectionDelivery(
	store: RecruitmentDecisionMutationStore,
	outbox: OutboxDeliveryService,
	clock: Clock,
	botUsername: string,
	collaboration: ApplicationDecisionCollaboration,
	status: "published" | "matched",
	acceptedCount: number,
	projectionRevision: number,
	occurredAt: number,
): Promise<string> {
	await store.supersedeOlderProjectionDeliveries({
		collaborationId: collaboration.id,
		beforeProjectionRevision: projectionRevision,
		updatedAt: Math.max(occurredAt, clock.now().getTime()),
	});
	const delivery = await outbox.createWithinTransaction({
		id: randomUUID(),
		idempotencyKey: `channel:${collaboration.id}:projection:${projectionRevision}`,
		kind: "channel_edit",
		recipientChatId: collaboration.publication.channelChatId,
		messageId: collaboration.publication.messageId,
		payload: renderDecisionProjection(collaboration, status, acceptedCount, botUsername),
	});
	return delivery.id;
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
