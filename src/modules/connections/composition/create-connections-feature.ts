import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { ConnectionService } from "../application/connection-service.js";
import { SqliteConnectionRepository } from "../infrastructure/sqlite-connection-repository.js";
import { SqliteIntroductionRepository } from "../infrastructure/sqlite-introduction-repository.js";
import { IntroductionService } from "../application/introduction-service.js";
import type { OutboxDeliveryStore } from "../../../shared/application/ports/outbox-delivery-store.js";
import { OutboxDeliveryService } from "../../../shared/application/outbox/outbox-service.js";

export function createConnectionsFeature(options: { database: SqlDatabase; transactions: TransactionRunner; clock: Clock; crypto: CryptoCapabilities; mfmFeatureEnabled: boolean; outboxStore?: OutboxDeliveryStore; botUsername?: string }) {
	return { api: new ConnectionService(new SqliteConnectionRepository(options.database), options.transactions, options.clock, options.crypto, options.mfmFeatureEnabled),
		introductions: options.outboxStore === undefined || options.botUsername === undefined ? undefined : new IntroductionService(new SqliteIntroductionRepository(options.database), options.transactions, options.clock, options.crypto, new OutboxDeliveryService(options.outboxStore, options.transactions, options.clock), options.botUsername, options.mfmFeatureEnabled) };
}
