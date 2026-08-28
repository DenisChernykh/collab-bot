import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import { CollaborationBrowseService } from "../application/collaboration-browse-service.js";
import { SqliteCollaborationBrowseRepository } from "../infrastructure/sqlite-collaboration-browse-repository.js";

export interface MarketplaceFeature {
	readonly browse: CollaborationBrowseService;
}

export interface CreateMarketplaceFeatureOptions {
	readonly boundary?: SqlDatabaseInput;
	readonly database?: SqlDatabase;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly crypto: CryptoCapabilities;
}

export function createMarketplaceFeature(options: CreateMarketplaceFeatureOptions): MarketplaceFeature {
	const database = options.database ?? (options.boundary === undefined ? undefined : resolveSqlDatabase(options.boundary));
	if (database === undefined) throw new Error("marketplace feature requires a SQL database");
	return {
		browse: new CollaborationBrowseService(
			new SqliteCollaborationBrowseRepository(database),
			options.transactions,
			options.clock,
			options.crypto,
		),
	};
}
