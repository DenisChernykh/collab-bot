import type { Clock } from "../../shared/application/ports/clock.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "./node-sql-database.js";
import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface IngressRetentionResult {
	readonly processedUpdatesDeleted: number;
	readonly receiptsDeleted: number;
}

export class IngressRetentionService {
	private readonly database: SqlDatabase;

	constructor(
		source: SqlDatabaseInput,
		private readonly clock: Clock,
	) {
		this.database = resolveSqlDatabase(source);
	}

	async cleanup(): Promise<IngressRetentionResult> {
		const now = clockMilliseconds(this.clock);
		const cutoff = now - RETENTION_MS;
		return this.database.withTransaction(async () => {
			await this.database.execute(
				"CREATE TEMP TABLE __s0_04_retention_candidates (command_id TEXT PRIMARY KEY) WITHOUT ROWID",
			);
			try {
				await this.database.execute(
					"INSERT INTO __s0_04_retention_candidates (command_id) SELECT pu.command_id FROM processed_updates pu JOIN command_receipts cr ON cr.command_id = pu.command_id WHERE cr.source = 'telegram' AND cr.status = 'completed' AND pu.processed_at < ? AND pu.update_id NOT IN (SELECT update_id FROM processed_updates ORDER BY update_id DESC LIMIT 50000)",
					[cutoff],
				);
				const processedDelete = await this.database.execute(
					"DELETE FROM processed_updates WHERE command_id IN (SELECT command_id FROM __s0_04_retention_candidates)",
				);
				const receiptDelete = await this.database.execute(
					"DELETE FROM command_receipts WHERE command_id IN (SELECT command_id FROM __s0_04_retention_candidates) AND source = 'telegram' AND status = 'completed'",
				);
				return {
					processedUpdatesDeleted: processedDelete.changes ?? 0,
					receiptsDeleted: receiptDelete.changes ?? 0,
				};
			} finally {
				await this.database.execute("DROP TABLE __s0_04_retention_candidates");
			}
		});
	}
}

function clockMilliseconds(clock: Clock): number {
	const milliseconds = clock.now().getTime();
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
		throw new Error("retention clock returned an invalid date");
	}
	return milliseconds;
}
