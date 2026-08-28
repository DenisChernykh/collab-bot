import type {
	DurableCommandReceipt,
	DurableCommandStore,
} from "../../shared/application/ports/durable-command-store.js";
import type { DatabaseBoundary } from "./database-boundary.js";

interface ReceiptRow {
	command_id?: unknown;
	source?: unknown;
	telegram_update_id?: unknown;
	input_hash?: unknown;
	status?: unknown;
	result_json?: unknown;
}

export class SqliteDurableCommandStore implements DurableCommandStore {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findReceipt(commandId: string): Promise<DurableCommandReceipt | undefined> {
		const rows = await this.boundary.query<ReceiptRow>(
			"SELECT command_id, source, telegram_update_id, input_hash, status, result_json FROM command_receipts WHERE command_id = ?",
			[commandId],
		);
		const row = rows[0];
		if (row === undefined) {
			return undefined;
		}
		if (
			typeof row.command_id !== "string" ||
			(row.source !== "telegram" && row.source !== "operator" && row.source !== "runner") ||
			(row.telegram_update_id !== null && typeof row.telegram_update_id !== "number") ||
			typeof row.input_hash !== "string" ||
			(row.status !== "in_progress" && row.status !== "completed") ||
			(row.result_json !== null && typeof row.result_json !== "string")
		) {
			throw new Error("durable command receipt row is corrupt");
		}
		return {
			commandId: row.command_id,
			source: row.source,
			telegramUpdateId: row.telegram_update_id as number | null,
			inputHash: row.input_hash,
			status: row.status,
			resultJson: row.result_json as string | null,
		};
	}

	async findProcessedUpdate(updateId: number): Promise<{ updateId: number; commandId: string } | undefined> {
		const rows = await this.boundary.query<{ update_id?: unknown; command_id?: unknown }>(
			"SELECT update_id, command_id FROM processed_updates WHERE update_id = ?",
			[updateId],
		);
		const row = rows[0];
		if (row === undefined) {
			return undefined;
		}
		if (typeof row.update_id !== "number" || typeof row.command_id !== "string") {
			throw new Error("processed update row is corrupt");
		}
		return { updateId: row.update_id, commandId: row.command_id };
	}

	async insertInProgressReceipt(
		receipt: Omit<DurableCommandReceipt, "status" | "resultJson">,
		createdAt: number,
	): Promise<void> {
		await this.boundary.execute(
			"INSERT INTO command_receipts (command_id, source, telegram_update_id, input_hash, status, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, 'in_progress', NULL, ?, NULL)",
			[receipt.commandId, receipt.source, receipt.telegramUpdateId, receipt.inputHash, createdAt],
		);
	}

	async completeReceipt(commandId: string, resultJson: string, completedAt: number): Promise<void> {
		const result = await this.boundary.execute(
			"UPDATE command_receipts SET status = 'completed', result_json = ?, completed_at = ? WHERE command_id = ? AND status = 'in_progress'",
			[resultJson, completedAt, commandId],
		) as { changes?: number };
		if (result.changes !== 1) {
			throw new Error("durable command receipt completion fence failed");
		}
	}

	async insertProcessedUpdate(updateId: number, commandId: string, processedAt: number): Promise<void> {
		await this.boundary.execute(
			"INSERT INTO processed_updates (update_id, command_id, processed_at) VALUES (?, ?, ?)",
			[updateId, commandId, processedAt],
		);
	}
}
