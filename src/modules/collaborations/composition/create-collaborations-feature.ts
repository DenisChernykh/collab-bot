import type { Clock } from "../../../application/ports/clock.js";
import type { OutboxDeliveryStore } from "../../../application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../application/ports/transaction-runner.js";
import type { DatabaseBoundary } from "../../../infrastructure/database/database-boundary.js";
import { SqliteWizardAdmission } from "../../../infrastructure/database/wizard-admission.js";
import type { ProfileSessionRepository } from "../../profiles/application/index.js";
import { CollaborationDraftService } from "../application/collaboration-draft-service.js";
import { CollaborationPublicationService } from "../application/collaboration-publication-service.js";
import type { CollaborationSessionRepository } from "../application/ports/collaboration-session-repository.js";
import type { ShowcaseCapability } from "../application/ports/showcase-capability.js";
import { SqliteCollaborationPublicationRepository } from "../infrastructure/sqlite-collaboration-publication-repository.js";
import { SqliteCollaborationRepository } from "../infrastructure/sqlite-collaboration-repository.js";
import { SqliteCollaborationSessionRepository } from "../infrastructure/sqlite-collaboration-session-repository.js";

export interface CollaborationsFeature {
	readonly draft: CollaborationDraftService;
	readonly publication: CollaborationPublicationService;
	readonly sessions: CollaborationSessionRepository;
}

export interface CreateCollaborationsFeatureOptions {
	readonly boundary: DatabaseBoundary;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly outboxStore: OutboxDeliveryStore;
	readonly capability: ShowcaseCapability;
	readonly channelChatId: string;
	readonly botUsername: string;
	readonly profileSessions?: ProfileSessionRepository;
}

export function createCollaborationsFeature(options: CreateCollaborationsFeatureOptions): CollaborationsFeature {
	const repository = new SqliteCollaborationRepository(options.boundary);
	const sessions = new SqliteCollaborationSessionRepository(
		options.boundary,
		new SqliteWizardAdmission(options.boundary),
	);
	return {
		draft: new CollaborationDraftService(
			repository,
			sessions,
			options.transactions,
			options.clock,
			options.profileSessions,
		),
		publication: new CollaborationPublicationService(
			repository,
			new SqliteCollaborationPublicationRepository(options.boundary),
			sessions,
			options.outboxStore,
			options.transactions,
			options.clock,
			options.capability,
			options.channelChatId,
			options.botUsername,
		),
		sessions,
	};
}
