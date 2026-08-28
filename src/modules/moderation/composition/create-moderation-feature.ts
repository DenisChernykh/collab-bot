import { OutboxDeliveryService } from "../../../shared/application/outbox/outbox-service.js";
import type { OutboxDeliveryStore } from "../../../shared/application/ports/outbox-delivery-store.js";
import type { Clock } from "../../../shared/application/ports/clock.js";
import type { CryptoCapabilities } from "../../../shared/application/ports/crypto.js";
import type { TransactionRunner } from "../../../shared/application/ports/transaction-runner.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../../../platform/database/node-sql-database.js";
import type { SqlDatabase } from "../../../shared/application/ports/sql-database.js";
import { AdminModerationService } from "../application/admin-moderation-service.js";
import { SqliteAdminModerationRepository } from "../infrastructure/sqlite-admin-moderation-repository.js";

export interface CreateModerationFeatureOptions {
	readonly boundary?: SqlDatabaseInput;
	readonly database?: SqlDatabase;
	readonly outboxStore: OutboxDeliveryStore;
	readonly transactions: TransactionRunner;
	readonly clock: Clock;
	readonly crypto: CryptoCapabilities;
	readonly botUsername: string;
	readonly adminTelegramIds: readonly string[];
}

export interface ModerationFeature {
	readonly api: AdminModerationService;
}

export function createModerationFeature(options: CreateModerationFeatureOptions): ModerationFeature {
	const database = options.database ?? (options.boundary === undefined ? undefined : resolveSqlDatabase(options.boundary));
	if (database === undefined) throw new Error("moderation feature requires a SQL database");
	const repository = new SqliteAdminModerationRepository(database);
	const outbox = new OutboxDeliveryService(options.outboxStore, options.transactions, options.clock);

	return {
		api: new AdminModerationService({
			repository,
			outbox,
			transactions: options.transactions,
			clock: options.clock,
			crypto: options.crypto,
			botUsername: options.botUsername,
			adminTelegramIds: options.adminTelegramIds,
		}),
	};
}
