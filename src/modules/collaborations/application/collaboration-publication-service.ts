import { OutboxDeliveryService } from "../../../shared/application/outbox/outbox-service.js";
import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { OutboxDeliveryStore } from "../../../shared/application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { isDeadlineDue, isMutationAllowed } from "../domain/deadline.js";
import type { CollaborationPublicationRepository, CollaborationSummary } from "./ports/collaboration-publication-repository.js";
import type { CollaborationRepository } from "./ports/collaboration-repository.js";
import type { CollaborationSessionRepository } from "./ports/collaboration-session-repository.js";
import type { ShowcaseCapability } from "./ports/showcase-capability.js";
import { renderCollaborationCard } from "./collaboration-renderer.js";

export class PublicationUnavailableError extends Error {
	constructor() { super("showcase publication is unavailable"); this.name = "PublicationUnavailableError"; }
}

export class CollaborationNotPublishableError extends Error {
	constructor() { super("collaboration is not ready for publication"); this.name = "CollaborationNotPublishableError"; }
}

export interface PublishCollaborationResult {
	readonly collaborationId: string;
	readonly status: "publishing" | "published" | "publication_failed" | "expired";
	readonly deliveryId?: string;
}

export class CollaborationPublicationService {
	private readonly outbox: OutboxDeliveryService;

	constructor(
		private readonly collaborations: CollaborationRepository,
		private readonly publications: CollaborationPublicationRepository,
		private readonly sessions: CollaborationSessionRepository,
		outboxStore: OutboxDeliveryStore,
		private readonly transactions: TransactionRunner,
		private readonly clock: Clock,
		private readonly capability: ShowcaseCapability,
		private readonly channelChatId: string,
		private readonly botUsername: string,
		private readonly crypto: CryptoCapabilities,
	) { this.outbox = new OutboxDeliveryService(outboxStore, transactions, clock); }

	async publish(telegramUserId: string, collaborationId: string): Promise<PublishCollaborationResult> {
		if (!this.capability.canPublish) throw new PublicationUnavailableError();
		const now = clockMilliseconds(this.clock);
		return this.transactions.withTransaction(async () => {
			const current = await this.collaborations.findByIdForTelegramUser(telegramUserId, collaborationId);
			if (current === undefined) throw new CollaborationNotPublishableError();
			const existing = await this.publications.findByCollaborationId(collaborationId);
			if (existing !== undefined) {
				return { collaborationId, status: current.status as PublishCollaborationResult["status"], ...(existing.lastDeliveryId === null ? {} : { deliveryId: existing.lastDeliveryId }) };
			}
			if (current.status !== "draft" || current.publicToken !== null || current.responseDeadlineAt === null || !isMutationAllowed(now, current.responseDeadlineAt) || current.format === null || current.targetProfileType === null || current.topics.length === 0 || current.title === null || current.offerText === null || current.expectationText === null || current.slotsTotal === null) throw new CollaborationNotPublishableError();
			const token = this.crypto.randomBase64Url(16);
			const renderedText = renderCollaborationCard(current);
			const renderedHash = this.crypto.hashUtf8(renderedText);
			const deliveryId = this.crypto.uuid();
			const url = `https://t.me/${this.botUsername}?start=c_${token}`;
			await this.publications.markPublishing(collaborationId, token, now);
			await this.outbox.createWithinTransaction({ id: deliveryId, idempotencyKey: `collaboration:${collaborationId}:channel_send:1`, kind: "channel_send", recipientChatId: this.channelChatId, payload: { version: 1, method: "send", text: renderedText, replyMarkup: { inline_keyboard: [[{ text: "Открыть карточку", url }]] } } });
			await this.publications.insert({ collaborationId, channelChatId: this.channelChatId, messageId: null, status: "prepared", renderedTermsVersion: 1, renderedProjectionRevision: current.projectionRevision + 1, renderedHash, currentAttemptNo: 1, lastDeliveryId: deliveryId, lastErrorKind: null, updatedAt: now });
			await this.sessions.delete(telegramUserId);
			return { collaborationId, status: "publishing", deliveryId };
		});
	}

	listOwn(telegramUserId: string): Promise<readonly CollaborationSummary[]> { return this.publications.listOwn(telegramUserId); }

	async cancelExpiredPrepared(): Promise<number> {
		const now = clockMilliseconds(this.clock);
		return this.transactions.withTransaction(async () => {
			const pending = await this.publications.listPendingExpired(now);
			let changed = 0;
			for (const row of pending) {
				if (await this.outbox.cancelUnclaimed(row.deliveryId) && await this.publications.markDeadlineExpired(row.collaborationId, now)) changed += 1;
			}
			return changed;
		});
	}

	async projectTerminalOutcomes(deliveries: OutboxDeliveryStore): Promise<void> {
		const ids = await this.publications.listTerminalDeliveryIds();
		for (const id of ids) await this.projectDelivery(id, deliveries);
	}

	async projectDelivery(deliveryId: string, deliveries: OutboxDeliveryStore): Promise<void> {
		const publication = await this.publications.findByDeliveryId(deliveryId);
		if (publication === undefined) return;
		const delivery = await deliveries.findById(deliveryId);
		if (delivery === undefined) return;
		if (delivery.status === "sent" && delivery.messageId !== null) {
			const collaboration = await this.collaborations.findById(publication.collaborationId);
			const outcomeAt = delivery.updatedAt;
			if (collaboration !== undefined && collaboration.responseDeadlineAt !== null && isDeadlineDue(outcomeAt, collaboration.responseDeadlineAt)) {
				await this.transactions.withTransaction(async () => {
					if (!(await this.publications.markExpired(publication.collaborationId, delivery.messageId!, outcomeAt))) return;
					const terminalText = renderCollaborationCard(collaboration, { expired: true });
					await this.outbox.createWithinTransaction({ id: this.crypto.uuid(), idempotencyKey: `collaboration:${publication.collaborationId}:channel_edit:expired:v1`, kind: "channel_edit", recipientChatId: publication.channelChatId, messageId: delivery.messageId!, payload: { version: 1, method: "edit", text: terminalText, replyMarkup: { inline_keyboard: [] } } });
				});
			} else await this.publications.markOutcome(publication.collaborationId, "published", delivery.messageId, null, outcomeAt);
		} else if (delivery.status === "permanent_failed" || delivery.status === "ambiguous" || delivery.status === "cancelled") {
			await this.publications.markOutcome(publication.collaborationId, "failed", delivery.messageId, delivery.lastErrorKind ?? "unknown", delivery.updatedAt);
		}
	}
}

function clockMilliseconds(clock: Clock): number {
	const value = clock.now().getTime();
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("publication clock returned an unsafe timestamp");
	return value;
}
