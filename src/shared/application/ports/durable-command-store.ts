import type { CommandSource } from "../commands/command-contracts.js";

export interface DurableCommandReceipt {
	readonly commandId: string;
	readonly source: CommandSource;
	readonly telegramUpdateId: number | null;
	readonly inputHash: string;
	readonly status: "in_progress" | "completed";
	readonly resultJson: string | null;
}

export interface ProcessedUpdate {
	readonly updateId: number;
	readonly commandId: string;
}

export interface DurableCommandStore {
	findReceipt(commandId: string): Promise<DurableCommandReceipt | undefined>;
	findProcessedUpdate(updateId: number): Promise<ProcessedUpdate | undefined>;
	insertInProgressReceipt(
		receipt: Omit<DurableCommandReceipt, "status" | "resultJson">,
		createdAt: number,
	): Promise<void>;
	completeReceipt(commandId: string, resultJson: string, completedAt: number): Promise<void>;
	insertProcessedUpdate(updateId: number, commandId: string, processedAt: number): Promise<void>;
}
