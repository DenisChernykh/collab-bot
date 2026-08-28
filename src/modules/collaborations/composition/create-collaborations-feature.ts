import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import { webCryptoCapabilities } from "../../../platform/crypto/capabilities.js";
import type { OutboxDeliveryStore } from "../../../shared/application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import { SqliteWizardAdmission } from "../../../platform/database/wizard-admission.js";
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
	readonly boundary?: SqlDatabaseInput;
	readonly database?: SqlDatabase;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly crypto?: CryptoCapabilities;
	readonly outboxStore: OutboxDeliveryStore;
	readonly capability: ShowcaseCapability;
	readonly channelChatId: string;
	readonly botUsername: string;
	readonly profileSessions?: ProfileSessionRepository;
}

export function createCollaborationsFeature(options: CreateCollaborationsFeatureOptions): CollaborationsFeature {
	const database = options.database ?? (options.boundary === undefined ? undefined : resolveSqlDatabase(options.boundary));
	if (database === undefined) throw new Error("collaborations feature requires a SQL database");
	const repository = new SqliteCollaborationRepository(database);
	const sessions = new SqliteCollaborationSessionRepository(
		database,
		new SqliteWizardAdmission(database),
	);
	return {
		draft: new CollaborationDraftService(
			repository,
			sessions,
			options.transactions,
			options.clock,
			options.crypto ?? webCryptoCapabilities,
			options.profileSessions,
		),
		publication: new CollaborationPublicationService(
			repository,
			new SqliteCollaborationPublicationRepository(database),
			sessions,
			options.outboxStore,
			options.transactions,
			options.clock,
			options.capability,
			options.channelChatId,
			options.botUsername,
			options.crypto ?? webCryptoCapabilities,
		),
		sessions,
	};
}
