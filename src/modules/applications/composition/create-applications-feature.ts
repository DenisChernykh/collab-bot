import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { OutboxDeliveryStore } from "../../../shared/application/ports/outbox-delivery-store.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
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
	readonly boundary?: SqlDatabaseInput;
	readonly database?: SqlDatabase;
	readonly outboxStore: OutboxDeliveryStore;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly crypto: CryptoCapabilities;
	readonly botUsername: string;
}

export function createApplicationsFeature(options: CreateApplicationsFeatureOptions): ApplicationsFeature {
	const database = options.database ?? (options.boundary === undefined ? undefined : resolveSqlDatabase(options.boundary));
	if (database === undefined) throw new Error("applications feature requires a SQL database");
	const repository = new SqliteApplicationsRepository(database);
	const applicationService = new ApplicationService(
		repository,
		options.outboxStore,
		options.transactions,
		options.clock,
		options.botUsername,
		options.crypto,
	);
	return {
		api: applicationService,
		applicationService,
		projectionMaintenance: repository,
	};
}
