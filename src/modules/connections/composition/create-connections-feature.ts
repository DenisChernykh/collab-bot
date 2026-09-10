import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { ConnectionService } from "../application/connection-service.js";
import { SqliteConnectionRepository } from "../infrastructure/sqlite-connection-repository.js";

export function createConnectionsFeature(options: { database: SqlDatabase; transactions: TransactionRunner; clock: Clock; crypto: CryptoCapabilities; mfmFeatureEnabled: boolean }) {
	return { api: new ConnectionService(new SqliteConnectionRepository(options.database), options.transactions, options.clock, options.crypto, options.mfmFeatureEnabled) };
}
