import type { Clock } from "../../../shared/application/ports/clock.js";
import type { OutboxDeliveryStore } from "../../../shared/application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type { DatabaseBoundary } from "../../../infrastructure/database/database-boundary.js";
import { ApplicationService, type ApplicationsFeatureApi } from "../application/application-feature.js";
import { SqliteApplicationsRepository } from "../infrastructure/sqlite-applications-repository.js";

export interface ApplicationsProjectionMaintenance {
	supersedeStaleProjectionDeliveries(updatedAt: number): Promise<number>;
}

export interface ApplicationsFeature {
	readonly api: ApplicationsFeatureApi;
	/** Compatibility service for the current Telegram presentation contract. */
	readonly applicationService: ApplicationService;
	readonly projectionMaintenance: ApplicationsProjectionMaintenance;
}

export interface CreateApplicationsFeatureOptions {
	readonly boundary: DatabaseBoundary;
	readonly outboxStore: OutboxDeliveryStore;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly botUsername: string;
}

export function createApplicationsFeature(options: CreateApplicationsFeatureOptions): ApplicationsFeature {
	const repository = new SqliteApplicationsRepository(options.boundary);
	const applicationService = new ApplicationService(
		repository,
		options.outboxStore,
		options.transactions,
		options.clock,
		options.botUsername,
	);
	return {
		api: applicationService,
		applicationService,
		projectionMaintenance: repository,
	};
}
