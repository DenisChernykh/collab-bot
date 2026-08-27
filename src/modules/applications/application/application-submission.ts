import { randomUUID } from "node:crypto";

import type { DeliverySendPayload } from "../../../application/outbox/delivery-payload.js";
import { OutboxDeliveryService } from "../../../application/outbox/outbox-service.js";
import type { Clock } from "../../../application/ports/clock.js";
import type { OutboxDeliveryStore } from "../../../application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../application/ports/transaction-runner.js";
import type { ProfileType, Topic } from "../../../domain/value-objects/enums.js";
import {
	APPLICATION_TERMS_VERSION,
	type ApplicationEligibility,
	type ApplicationEligibilityInput,
	type ApplicationRecord,
	type ApplicationSubmissionContext,
	type ApplicationSubmitInput,
	type ApplicationSubmitResult,
	type PublicApplicantSnapshot,
} from "./application-contracts.js";
import { assertEligibilityInput, evaluateEligibility } from "./application-policy.js";

export interface CheckApplicationEligibilityReader {
	findSubmissionContext(
		telegramUserId: string,
		collaborationId: string,
	): Promise<ApplicationSubmissionContext | undefined>;
}

export interface SubmitApplicationStore extends CheckApplicationEligibilityReader {
	insertPending(record: ApplicationRecord): Promise<void>;
	setFirstApplicationAt(collaborationId: string, firstApplicationAt: number): Promise<boolean>;
}

export class CheckApplicationEligibilityUseCase {
	constructor(
		private readonly reader: CheckApplicationEligibilityReader,
		private readonly transactions: TransactionRunner,
	) {}

	execute(input: ApplicationEligibilityInput): Promise<ApplicationEligibility> {
		assertEligibilityInput(input);
		return this.transactions.withTransaction(async () => {
			const context = await this.reader.findSubmissionContext(input.telegramUserId, input.collaborationId);
			return evaluateEligibility(context, input.telegramUserId, input.occurredAt);
		});
	}
}

export class SubmitApplicationUseCase {
	private readonly outbox: OutboxDeliveryService;

	constructor(
		private readonly store: SubmitApplicationStore,
		outboxStore: OutboxDeliveryStore,
		private readonly transactions: TransactionRunner,
		clock: Clock,
		private readonly botUsername: string,
	) {
		this.outbox = new OutboxDeliveryService(outboxStore, transactions, clock);
	}

	async execute(input: ApplicationSubmitInput): Promise<ApplicationSubmitResult> {
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

function profileTypeLabel(value: ProfileType): string {
	return ({ blogger: "Блогер", telegram_channel: "Telegram-канал", venue_or_brand: "Заведение или бренд" } as const)[value];
}

function topicLabel(value: Topic): string {
	return ({ lifestyle: "Lifestyle", food: "Еда и рестораны", beauty: "Красота", travel: "Путешествия", city: "Город", events: "События", family: "Семья", sport: "Спорт", business: "Бизнес", other: "Другое" } as const)[value];
}
