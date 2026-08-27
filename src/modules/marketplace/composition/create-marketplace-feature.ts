import type { Clock } from "../../../application/ports/clock.js";
import type { TransactionRunner } from "../../../application/ports/transaction-runner.js";
import type { DatabaseBoundary } from "../../../infrastructure/database/database-boundary.js";
import { CollaborationBrowseService } from "../application/collaboration-browse-service.js";
import { SqliteCollaborationBrowseRepository } from "../infrastructure/sqlite-collaboration-browse-repository.js";

export interface MarketplaceFeature {
	readonly browse: CollaborationBrowseService;
}

export interface CreateMarketplaceFeatureOptions {
	readonly boundary: DatabaseBoundary;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
}

export function createMarketplaceFeature(options: CreateMarketplaceFeatureOptions): MarketplaceFeature {
	return {
		browse: new CollaborationBrowseService(
			new SqliteCollaborationBrowseRepository(options.boundary),
			options.transactions,
			options.clock,
		),
	};
}
