import type { Clock } from "../../application/ports/clock.js";
import { DatabaseBoundary } from "./database-boundary.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface IngressRetentionResult {
	readonly processedUpdatesDeleted: number;
	readonly receiptsDeleted: number;
}

export class IngressRetentionService {
	constructor(
		private readonly boundary: DatabaseBoundary,
		private readonly clock: Clock,
	) {}

	async cleanup(): Promise<IngressRetentionResult> {
		const now = clockMilliseconds(this.clock);
		const cutoff = now - RETENTION_MS;
		return this.boundary.withTransaction(async (context) => {
			context.client.exec(
				"CREATE TEMP TABLE __s0_04_retention_candidates (command_id TEXT PRIMARY KEY) WITHOUT ROWID",
			);
			try {
				context.client
					.prepare(
						"INSERT INTO __s0_04_retention_candidates (command_id) SELECT pu.command_id FROM processed_updates pu JOIN command_receipts cr ON cr.command_id = pu.command_id WHERE cr.source = 'telegram' AND cr.status = 'completed' AND pu.processed_at < ? AND pu.update_id NOT IN (SELECT update_id FROM processed_updates ORDER BY update_id DESC LIMIT 50000)",
					)
					.run(cutoff);
				const processedDelete = context.client
					.prepare(
						"DELETE FROM processed_updates WHERE command_id IN (SELECT command_id FROM __s0_04_retention_candidates)",
					)
					.run() as { changes?: number };
				const receiptDelete = context.client
					.prepare(
						"DELETE FROM command_receipts WHERE command_id IN (SELECT command_id FROM __s0_04_retention_candidates) AND source = 'telegram' AND status = 'completed'",
					)
					.run() as { changes?: number };
				return {
					processedUpdatesDeleted: processedDelete.changes ?? 0,
					receiptsDeleted: receiptDelete.changes ?? 0,
				};
			} finally {
				context.client.exec("DROP TABLE __s0_04_retention_candidates");
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
