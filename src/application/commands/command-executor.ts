import type { Clock } from "../../shared/application/ports/clock.js";
import type { CanonicalInput } from "./canonical-input.js";
import type { CanonicalInputHasher } from "../../shared/application/ports/ingress-crypto.js";
import type {
	DurableCommandReceipt,
	DurableCommandStore,
} from "../ports/durable-command-store.js";
import type { TransactionRunner } from "../../shared/application/ports/transaction-runner.js";
import {
	parseSafeResult,
	serializeSafeResult,
	type SafeResult,
} from "./safe-result.js";
import type { CommandContext, CommandSource } from "./command-contracts.js";

export interface DurableCommandRequest {
	readonly context: CommandContext;
	readonly input: CanonicalInput;
	readonly effect: () => SafeResult | PromiseLike<SafeResult>;
}

export class CommandConflictError extends Error {
	constructor() {
		super("command identity conflict");
		this.name = "CommandConflictError";
	}
}

export class CommandIncidentError extends Error {
	constructor() {
		super("durable command receipt requires operator investigation");
		this.name = "CommandIncidentError";
	}
}

export class CommandContextValidationError extends Error {
	constructor() {
		super("command context is invalid");
		this.name = "CommandContextValidationError";
	}
}

interface CommandIdentity {
	readonly commandId: string;
	readonly source: CommandSource;
	readonly telegramUpdateId: number | null;
	readonly inputHash: string;
}

export class DurableCommandExecutor {
	constructor(
		private readonly transactionRunner: TransactionRunner,
		private readonly commandStore: DurableCommandStore,
		private readonly inputHasher: CanonicalInputHasher,
		private readonly clock: Clock,
	) {}

	async execute(request: DurableCommandRequest): Promise<SafeResult> {
		const identity = deriveIdentity(request.context, request.input, this.inputHasher);
		return this.transactionRunner.withTransaction(async () => {
			const receipt = await this.commandStore.findReceipt(identity.commandId);
			const processedUpdate = identity.telegramUpdateId === null
				? undefined
				: await this.commandStore.findProcessedUpdate(identity.telegramUpdateId);

			if (processedUpdate !== undefined && processedUpdate.commandId !== identity.commandId) {
				throw new CommandConflictError();
			}
			if (receipt !== undefined) {
				assertReceiptIdentity(receipt, identity);
				if (receipt.status !== "completed") {
					throw new CommandIncidentError();
				}
				if (receipt.resultJson === null || (identity.source === "telegram" && processedUpdate === undefined)) {
					throw new CommandIncidentError();
				}
				try {
					return parseSafeResult(receipt.resultJson);
				} catch {
					throw new CommandIncidentError();
				}
			}
			if (processedUpdate !== undefined) {
				throw new CommandIncidentError();
			}

			const createdAt = clockMilliseconds(this.clock);
			await this.commandStore.insertInProgressReceipt(identity, createdAt);
			const result = await request.effect();
			const resultJson = serializeSafeResult(result);
			const completedAt = clockMilliseconds(this.clock);
			await this.commandStore.completeReceipt(identity.commandId, resultJson, completedAt);
			if (identity.source === "telegram") {
				await this.commandStore.insertProcessedUpdate(identity.telegramUpdateId as number, identity.commandId, completedAt);
			}
			return parseSafeResult(resultJson);
		});
	}
}

function deriveIdentity(
	context: CommandContext,
	input: CanonicalInput,
	inputHasher: CanonicalInputHasher,
): CommandIdentity {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context.commandId)) {
		throw new CommandContextValidationError();
	}
	if (!(context.occurredAt instanceof Date) || !Number.isFinite(context.occurredAt.getTime())) {
		throw new CommandContextValidationError();
	}
	const occurredAt = context.occurredAt.getTime();
	const updateId = context.telegramUpdateId;
	if (updateId !== undefined && (!Number.isSafeInteger(updateId) || updateId < 0)) {
		throw new CommandContextValidationError();
	}
	let source: CommandSource;
	let telegramUpdateId: number | null;
	switch (context.actor.kind) {
		case "telegram_user":
			if (!isTelegramUserId(context.actor.telegramUserId) || updateId === undefined) {
				throw new CommandContextValidationError();
			}
			source = "telegram";
			telegramUpdateId = updateId;
			break;
		case "admin":
			if (!isTelegramUserId(context.actor.telegramUserId)) {
				throw new CommandContextValidationError();
			}
			source = updateId === undefined ? "operator" : "telegram";
			telegramUpdateId = updateId ?? null;
			break;
		case "runner":
			if (updateId !== undefined) {
				throw new CommandContextValidationError();
			}
			source = "runner";
			telegramUpdateId = null;
			break;
		default:
			throw new CommandContextValidationError();
	}
	return {
		commandId: context.commandId,
		source,
		telegramUpdateId,
		inputHash: inputHasher.hash({
			actor: canonicalActor(context),
			occurredAt,
			input,
		}),
	};
}

function canonicalActor(context: CommandContext): CanonicalInput {
	switch (context.actor.kind) {
		case "telegram_user":
		case "admin":
			return { kind: context.actor.kind, telegramUserId: context.actor.telegramUserId };
		case "runner":
			return { kind: context.actor.kind, runner: context.actor.runner };
		default:
			throw new CommandContextValidationError();
	}
}

function assertReceiptIdentity(receipt: DurableCommandReceipt, identity: CommandIdentity): void {
	if (
		receipt.source !== identity.source ||
		receipt.telegramUpdateId !== identity.telegramUpdateId ||
		receipt.inputHash !== identity.inputHash
	) {
		throw new CommandConflictError();
	}
}

function isTelegramUserId(value: string): boolean {
	return /^[0-9]+$/.test(value);
}

function clockMilliseconds(clock: Clock): number {
	const milliseconds = clock.now().getTime();
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
		throw new CommandContextValidationError();
	}
	return milliseconds;
}
