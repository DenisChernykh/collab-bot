import { OutboxDeliveryService } from "../../../application/outbox/outbox-service.js";
import type { OutboxDeliveryStore } from "../../../application/ports/outbox-delivery-store.js";
import type { Clock } from "../../../shared/application/ports/clock.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type { DatabaseBoundary } from "../../../infrastructure/database/database-boundary.js";
import { AdminModerationService } from "../application/admin-moderation-service.js";
import { SqliteAdminModerationRepository } from "../infrastructure/sqlite-admin-moderation-repository.js";

export interface CreateModerationFeatureOptions {
	readonly boundary: DatabaseBoundary;
	readonly outboxStore: OutboxDeliveryStore;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly botUsername: string;
	readonly adminTelegramIds: readonly string[];
}

export interface ModerationFeature {
	readonly api: AdminModerationService;
}

export function createModerationFeature(options: CreateModerationFeatureOptions): ModerationFeature {
	const repository = new SqliteAdminModerationRepository(options.boundary);
	const outbox = new OutboxDeliveryService(options.outboxStore, options.transactions, options.clock);

	return {
		api: new AdminModerationService({
			repository,
			outbox,
			transactions: options.transactions,
			clock: options.clock,
			botUsername: options.botUsername,
			adminTelegramIds: options.adminTelegramIds,
		}),
	};
}
