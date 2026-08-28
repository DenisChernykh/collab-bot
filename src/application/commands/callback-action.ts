import type { Clock } from "../../shared/application/ports/clock.js";
import type { CommandContext } from "./command-contracts.js";
import type {
	CallbackActionMode,
	CallbackActionRecord,
	CallbackActionStore,
} from "../ports/callback-action-store.js";
import { CallbackActionStoreCorruptError } from "../ports/callback-action-store.js";
import type { OpaqueTokenCodec } from "../../shared/application/ports/ingress-crypto.js";
import type { TransactionRunner } from "../../shared/application/ports/transaction-runner.js";
import {
	parseSafeResult,
	serializeSafeResult,
	type SafeResult,
} from "./safe-result.js";
import {
	normalizeTelegramUserActor,
	RequireActiveActor,
	type TelegramUserIngressActor,
} from "./require-active-actor.js";
import { CommandConflictError, DurableCommandExecutor } from "./command-executor.js";

export interface CallbackActionCreateRequest {
	readonly actor: TelegramUserIngressActor;
	readonly actionType: string;
	readonly entityId?: string;
	readonly expectedVersion?: number;
	readonly mode: CallbackActionMode;
	readonly expiresAt: number;
}

export interface CallbackActionInvokeRequest {
	readonly context: CommandContext;
	readonly callbackPayload: string;
	readonly effect: (action: CallbackActionRecord) => SafeResult | PromiseLike<SafeResult>;
}

export interface CallbackActionServiceOptions {
	readonly transactionRunner: TransactionRunner;
	readonly clock: Clock;
	readonly executor: DurableCommandExecutor;
	readonly repository: CallbackActionStore;
	readonly actorGuard: RequireActiveActor;
	readonly allowedActionTypes: ReadonlySet<string>;
	readonly currentVersion?: (entityId: string) => number | undefined | PromiseLike<number | undefined>;
	readonly tokenCodec: OpaqueTokenCodec;
}

export class CallbackActorValidationError extends Error {
	constructor() {
		super("callback actor is not a private Telegram user");
		this.name = "CallbackActorValidationError";
	}
}

export class CallbackActionValidationError extends Error {
	constructor() {
		super("callback action is invalid");
		this.name = "CallbackActionValidationError";
	}
}

export class CallbackActionIncidentError extends Error {
	constructor() {
		super("callback action requires operator investigation");
		this.name = "CallbackActionIncidentError";
	}
}

export class CallbackActionService {
	constructor(private readonly options: CallbackActionServiceOptions) {}

	async create(request: CallbackActionCreateRequest): Promise<string> {
		const actor = normalizeTelegramUserActor(request.actor);
		if (actor === undefined) {
			throw new CallbackActorValidationError();
		}
		validateDefinition(request, this.options.allowedActionTypes, this.options.clock);
		const token = `cb_${this.options.tokenCodec.generateCallbackToken()}`;
		if (!/^cb_[A-Za-z0-9_-]+$/.test(token) || token.length > 64) {
			throw new CallbackActionValidationError();
		}
		const record: CallbackActionRecord = {
			tokenHash: this.options.tokenCodec.hash(token),
			actorTelegramUserId: actor.telegramUserId,
			actionType: request.actionType,
			entityId: request.entityId ?? null,
			expectedVersion: request.expectedVersion ?? null,
			mode: request.mode,
			expiresAt: request.expiresAt,
			consumedAt: null,
			resultJson: null,
		};
		await this.options.transactionRunner.withTransaction(() => {
			return this.options.repository.insert(record);
		});
		return token;
	}

	async invoke(request: CallbackActionInvokeRequest): Promise<SafeResult> {
		if (!/^cb_[A-Za-z0-9_-]+$/.test(request.callbackPayload) || request.callbackPayload.length > 64) {
			return unavailable();
		}
		if (normalizeTelegramUserActor(request.context.actor) === undefined) {
			return unavailable();
		}
		const tokenHash = this.options.tokenCodec.hash(request.callbackPayload);
		return this.options.executor.execute({
			context: request.context,
			input: { callback: request.callbackPayload },
			effect: async () => {
				const actorDecision = await this.options.actorGuard.check(request.context.actor);
				if (!actorDecision.allowed) {
					return actorDecision.result;
				}
				let action: CallbackActionRecord | undefined;
				try {
					action = await this.options.repository.findByTokenHash(tokenHash);
				} catch (error) {
					if (error instanceof CallbackActionStoreCorruptError) {
						throw new CallbackActionIncidentError();
					}
					throw error;
				}
				if (action === undefined || action.actorTelegramUserId !== actorDecision.actor.telegramUserId) {
					return unavailable();
				}
				if (!this.options.allowedActionTypes.has(action.actionType)) {
					return unavailable();
				}
				if (action.consumedAt !== null) {
					if (action.resultJson === null) {
						throw new CallbackActionIncidentError();
					}
					try {
						return parseSafeResult(action.resultJson);
					} catch {
						throw new CallbackActionIncidentError();
					}
				}
				const now = clockMilliseconds(this.options.clock);
				if (now >= action.expiresAt) {
					return expired();
				}
				if (action.expectedVersion !== null) {
					if (action.entityId === null || this.options.currentVersion === undefined) {
						return stale();
					}
					const currentVersion = await this.options.currentVersion(action.entityId);
					if (currentVersion !== action.expectedVersion) {
						return stale();
					}
				}
				const result = await request.effect(action);
				const resultJson = serializeSafeResult(result);
				if (action.mode === "one_shot") {
					try {
						await this.options.repository.consume(tokenHash, now, resultJson);
					} catch (error) {
						if (error instanceof CallbackActionStoreCorruptError) {
							throw new CallbackActionIncidentError();
						}
						throw error;
					}
				}
				return parseSafeResult(resultJson);
			},
		}).catch((error: unknown) => {
			if (error instanceof CommandConflictError) {
				return unavailable();
			}
			throw error;
		});
	}

	async cleanupExpired(): Promise<number> {
		const now = clockMilliseconds(this.options.clock);
		return this.options.transactionRunner.withTransaction(() => this.options.repository.deleteExpired(now));
	}
}

function validateDefinition(
	request: CallbackActionCreateRequest,
	allowedActionTypes: ReadonlySet<string>,
	clock: Clock,
): void {
	if (!allowedActionTypes.has(request.actionType) || !/^[a-z][a-z0-9._-]{0,63}$/.test(request.actionType)) {
		throw new CallbackActionValidationError();
	}
	if (request.mode !== "one_shot" && request.mode !== "reusable") {
		throw new CallbackActionValidationError();
	}
	if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= clockMilliseconds(clock)) {
		throw new CallbackActionValidationError();
	}
	if (request.entityId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.entityId)) {
		throw new CallbackActionValidationError();
	}
	if (request.expectedVersion !== undefined &&
		(!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 0 || request.entityId === undefined)) {
		throw new CallbackActionValidationError();
	}
}

function clockMilliseconds(clock: Clock): number {
	const milliseconds = clock.now().getTime();
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
		throw new CallbackActionValidationError();
	}
	return milliseconds;
}

function unavailable(): SafeResult {
	return { version: 1, outcome: "unavailable", messageKey: "callback_unavailable" };
}

function stale(): SafeResult {
	return { version: 1, outcome: "stale", messageKey: "callback_stale" };
}

function expired(): SafeResult {
	return { version: 1, outcome: "expired", messageKey: "callback_expired" };
}
