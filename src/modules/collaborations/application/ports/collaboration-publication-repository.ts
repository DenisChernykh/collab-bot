import type { DeliveryErrorKind } from "../../../../shared/application/ports/outbox-delivery-store.js";
import type { CollaborationRecord } from "../../domain/collaboration.js";

export type CollaborationPublicationStatus = "prepared" | "sending" | "published" | "failed";

export interface CollaborationPublicationRecord {
	readonly collaborationId: string;
	readonly channelChatId: string;
	readonly messageId: number | null;
	readonly status: CollaborationPublicationStatus;
	readonly renderedTermsVersion: number;
	readonly renderedProjectionRevision: number;
	readonly renderedHash: string;
	readonly currentAttemptNo: number;
	readonly lastDeliveryId: string | null;
	readonly lastErrorKind: DeliveryErrorKind | null;
	readonly updatedAt: number;
}

export interface CollaborationSummary {
	readonly collaborationId: string;
	readonly title: string | null;
	readonly status: CollaborationRecord["status"];
	readonly format: CollaborationRecord["format"];
	readonly responseDeadlineAt: number | null;
	readonly eventDateLocal: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface CollaborationPublicationRepository {
	findByCollaborationId(collaborationId: string): Promise<CollaborationPublicationRecord | undefined>;
	findByDeliveryId(deliveryId: string): Promise<CollaborationPublicationRecord | undefined>;
	insert(record: CollaborationPublicationRecord): Promise<void>;
	markPublishing(collaborationId: string, publicToken: string, updatedAt: number): Promise<void>;
	updatePrepared(record: CollaborationPublicationRecord): Promise<void>;
	listOwn(telegramUserId: string): Promise<readonly CollaborationSummary[]>;
	listPendingExpired(now: number): Promise<readonly { collaborationId: string; deliveryId: string; }[]>;
	listTerminalDeliveryIds(): Promise<readonly string[]>;
	markOutcome(collaborationId: string, status: CollaborationPublicationStatus, messageId: number | null, errorKind: DeliveryErrorKind | null, updatedAt: number): Promise<boolean>;
	markExpired(collaborationId: string, messageId: number, updatedAt: number): Promise<boolean>;
	markDeadlineExpired(collaborationId: string, updatedAt: number): Promise<boolean>;
}
