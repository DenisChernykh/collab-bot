import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import type { DatabaseBoundary } from "../../../platform/database/database-boundary.js";
import { CollaborationBrowseService } from "../application/collaboration-browse-service.js";
import { SqliteCollaborationBrowseRepository } from "../infrastructure/sqlite-collaboration-browse-repository.js";

export interface MarketplaceFeature {
	readonly browse: CollaborationBrowseService;
}

export interface CreateMarketplaceFeatureOptions {
	readonly boundary: DatabaseBoundary;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly crypto: CryptoCapabilities;
}

export function createMarketplaceFeature(options: CreateMarketplaceFeatureOptions): MarketplaceFeature {
	return {
		browse: new CollaborationBrowseService(
			new SqliteCollaborationBrowseRepository(options.boundary),
			options.transactions,
			options.clock,
			options.crypto,
		),
	};
}
