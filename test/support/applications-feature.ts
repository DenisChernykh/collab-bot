import type { Clock } from "../../src/application/ports/clock.js";
import type { OutboxDeliveryStore } from "../../src/application/ports/outbox-delivery-store.js";
import type { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import {
	createApplicationsFeature,
	type ApplicationsFeature,
} from "../../src/modules/applications/index.js";

export interface TestApplicationsFeatureOptions {
	readonly boundary: DatabaseBoundary;
	readonly clock: Clock;
	readonly outboxStore?: OutboxDeliveryStore;
	readonly botUsername?: string;
}

export function createTestApplicationsFeature(options: TestApplicationsFeatureOptions): ApplicationsFeature {
	return createApplicationsFeature({
		boundary: options.boundary,
		outboxStore: options.outboxStore ?? new SqliteOutboxDeliveryRepository(options.boundary),
		transactions: new DatabaseBoundaryTransactionRunner(options.boundary),
		clock: options.clock,
		botUsername: options.botUsername ?? "collab_bot",
	});
}
