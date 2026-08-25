import type { Clock } from "../ports/clock.js";
import type { ClaimTokenGenerator } from "../ports/claim-token.js";
import type {
	DeliveryErrorKind,
	OutboxDeliveryKind,
	OutboxDeliveryRecord,
	OutboxDeliveryStore,
} from "../ports/outbox-delivery-store.js";
import {
	ProviderDeadlineExceededError,
	ProviderShutdownAbortError,
	PROVIDER_DEADLINE_MS,
	type ProviderDeadline,
} from "../ports/provider-deadline.js";
import {
	TelegramTransportError,
	type TelegramTransport,
	type TelegramTransportRequest,
	type TelegramTransportResponse,
} from "../ports/telegram-transport.js";

export const DELIVERY_MAX_ATTEMPTS = 5;
export const DELIVERY_STALE_AFTER_MS = 60_000;
/** Known retries use 1s, 2s, 4s, 8s delays; attempt five becomes terminal. */
export const DELIVERY_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000] as const;

export type DeliveryRunOutcome = "idle" | "sent" | "retryable_failed" | "ambiguous" | "permanent_failed" | "fenced" | "shutdown" | "unsafe";

export interface DeliveryRunResult {
	readonly outcome: DeliveryRunOutcome;
	readonly deliveryId?: string;
}

type FailureDisposition =
	| { readonly outcome: "retryable_failed"; readonly errorKind: DeliveryErrorKind; readonly retryAfterSeconds: number | null }
	| { readonly outcome: "ambiguous"; readonly errorKind: DeliveryErrorKind }
	| { readonly outcome: "permanent_failed"; readonly errorKind: DeliveryErrorKind }
	| { readonly outcome: "sent" };

export class DeliveryRunner {
	private queue: Promise<void> = Promise.resolve();
	private readonly afterRun: ((result: DeliveryRunResult) => Promise<void>) | undefined;
	private readonly allowedKinds: (() => readonly OutboxDeliveryKind[]) | undefined;

	constructor(
		private readonly store: OutboxDeliveryStore,
		private readonly transport: TelegramTransport,
		private readonly deadline: ProviderDeadline,
		private readonly claimTokens: ClaimTokenGenerator,
		private readonly clock: Clock,
		afterRun?: (result: DeliveryRunResult) => Promise<void>,
		allowedKinds?: () => readonly OutboxDeliveryKind[],
	) { this.afterRun = afterRun; this.allowedKinds = allowedKinds; }

	runOnce(shutdownSignal?: AbortSignal): Promise<DeliveryRunResult> {
		const result = this.queue.then(async () => {
			const outcome = await this.runOnceInternal(shutdownSignal);
			if (this.afterRun !== undefined && outcome.deliveryId !== undefined) await this.afterRun(outcome);
			return outcome;
		});
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	async recoverStale(): Promise<number> {
		const now = clockMilliseconds(this.clock);
		const retryAtByAttempt = DELIVERY_RETRY_BACKOFF_MS.map((delay) => safeAddMilliseconds(now, delay));
		return this.store.recoverStale(now, safeAddMilliseconds(now, -DELIVERY_STALE_AFTER_MS) ?? 0, retryAtByAttempt);
	}

	private async runOnceInternal(shutdownSignal: AbortSignal | undefined): Promise<DeliveryRunResult> {
		try {
			if (shutdownSignal?.aborted) return { outcome: "shutdown" };
			await this.recoverStale();
			if (shutdownSignal?.aborted) return { outcome: "shutdown" };
			const now = clockMilliseconds(this.clock);
			const requestDeadlineAt = safeAddMilliseconds(now, PROVIDER_DEADLINE_MS);
			if (requestDeadlineAt === null) return { outcome: "unsafe" };
			if (shutdownSignal?.aborted) return { outcome: "shutdown" };
			const claimToken = this.claimTokens.generate();
			const record = await this.store.claimDue(now, claimToken, requestDeadlineAt, this.allowedKinds?.());
			if (record === undefined) return { outcome: "idle" };

			try {
				const response = await this.deadline.run(shutdownSignal, (signal) => this.transport.execute(toRequest(record, signal)));
				return await this.applySuccess(record, claimToken, response);
			} catch (error) {
				if (error instanceof ProviderShutdownAbortError) {
					return { outcome: "shutdown", deliveryId: record.id };
				}
				return this.applyFailure(record, claimToken, classifyFailure(record, error));
			}
		} catch (error) {
			if (error instanceof DeliverySafetyError) return { outcome: "unsafe" };
			throw error;
		}
	}

	private async applySuccess(record: OutboxDeliveryRecord, claimToken: string, response: TelegramTransportResponse): Promise<DeliveryRunResult> {
		const messageId = response.method === "send" ? response.messageId : record.messageId;
		if (typeof messageId !== "number" || !Number.isSafeInteger(messageId) || messageId <= 0 || response.method !== record.payload.method) {
			return this.applyFailure(record, claimToken, { outcome: "permanent_failed", errorKind: "unknown" });
		}
		const changed = await this.store.markSent(record.id, claimToken, clockMilliseconds(this.clock), messageId);
		return changed ? { outcome: "sent", deliveryId: record.id } : { outcome: "fenced", deliveryId: record.id };
	}

	private async applyFailure(record: OutboxDeliveryRecord, claimToken: string, disposition: FailureDisposition): Promise<DeliveryRunResult> {
		if (disposition.outcome === "sent") {
			const changed = await this.store.markSent(record.id, claimToken, clockMilliseconds(this.clock), record.messageId as number);
			return changed ? { outcome: "sent", deliveryId: record.id } : { outcome: "fenced", deliveryId: record.id };
		}
		const now = clockMilliseconds(this.clock);
		if (disposition.outcome === "ambiguous") {
			const changed = await this.store.markAmbiguous(record.id, claimToken, now, disposition.errorKind);
			return changed ? { outcome: "ambiguous", deliveryId: record.id } : { outcome: "fenced", deliveryId: record.id };
		}
		if (disposition.outcome === "permanent_failed" || record.attemptCount >= DELIVERY_MAX_ATTEMPTS) {
			const changed = await this.store.markPermanent(record.id, claimToken, now, disposition.errorKind);
			return changed ? { outcome: "permanent_failed", deliveryId: record.id } : { outcome: "fenced", deliveryId: record.id };
		}
		const retryAfterMs = disposition.retryAfterSeconds === null ? 0 : disposition.retryAfterSeconds * 1_000;
		const delay = Math.max(
			DELIVERY_RETRY_BACKOFF_MS[Math.min(record.attemptCount - 1, DELIVERY_RETRY_BACKOFF_MS.length - 1)] ?? DELIVERY_RETRY_BACKOFF_MS.at(-1)!,
			retryAfterMs,
		);
		const nextAttemptAt = safeAddMilliseconds(now, delay);
		if (nextAttemptAt === null) {
			const changed = await this.store.markPermanent(record.id, claimToken, now, "unknown");
			return changed ? { outcome: "permanent_failed", deliveryId: record.id } : { outcome: "fenced", deliveryId: record.id };
		}
		const changed = await this.store.markRetryable(
			record.id,
			claimToken,
			now,
			nextAttemptAt,
			disposition.errorKind,
			disposition.retryAfterSeconds,
		);
		return changed ? { outcome: "retryable_failed", deliveryId: record.id } : { outcome: "fenced", deliveryId: record.id };
	}
}

function toRequest(record: OutboxDeliveryRecord, signal: AbortSignal): TelegramTransportRequest {
	if (record.payload.method === "send") {
		return { method: "send", chatId: record.recipientChatId, text: record.payload.text, ...(record.payload.replyMarkup === undefined ? {} : { replyMarkup: record.payload.replyMarkup }), signal };
	}
	if (record.messageId === null) {
		throw new TelegramTransportError({ code: "unknown" });
	}
	if (record.payload.method === "edit") {
		return { method: "edit", chatId: record.recipientChatId, messageId: record.messageId, text: record.payload.text, ...(record.payload.replyMarkup === undefined ? {} : { replyMarkup: record.payload.replyMarkup }), signal };
	}
	return { method: "delete", chatId: record.recipientChatId, messageId: record.messageId, signal };
}

function classifyFailure(record: OutboxDeliveryRecord, error: unknown): FailureDisposition {
	if (error instanceof TelegramTransportError &&
		((error.code === "message_not_modified" && record.kind === "channel_edit") ||
		(error.code === "message_not_found" && record.kind === "channel_delete"))) {
		return { outcome: "sent" };
	}
	const code = error instanceof ProviderDeadlineExceededError || isAbortError(error) ? "provider_timeout" : error instanceof TelegramTransportError ? error.code : "unknown";
	const isSend = record.kind === "dm_send" || record.kind === "channel_send";
	if (code === "rate_limited") {
		const suppliedRetryAfter = error instanceof TelegramTransportError ? error.retryAfterSeconds : null;
		if (suppliedRetryAfter !== null && (!Number.isSafeInteger(suppliedRetryAfter) || suppliedRetryAfter < 0 || suppliedRetryAfter > Number.MAX_SAFE_INTEGER / 1_000)) {
			return { outcome: "permanent_failed", errorKind: "unknown" };
		}
		const retryAfterSeconds = suppliedRetryAfter === null || suppliedRetryAfter === 0 ? 1 : suppliedRetryAfter;
		return { outcome: "retryable_failed", errorKind: "rate_limited", retryAfterSeconds };
	}
	if (code === "network" || code === "connection_lost" || code === "provider_timeout") {
		if (isSend && (code === "provider_timeout" || error instanceof TelegramTransportError && error.phase === "after_possible_send")) {
			return { outcome: "ambiguous", errorKind: code === "provider_timeout" ? "provider_timeout" : "network" };
		}
		return { outcome: "retryable_failed", errorKind: code === "provider_timeout" ? "provider_timeout" : "network", retryAfterSeconds: null };
	}
	if (code === "forbidden" || code === "invalid_chat" || code === "not_found") {
		return { outcome: "permanent_failed", errorKind: code };
	}
	return { outcome: "permanent_failed", errorKind: "unknown" };
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function clockMilliseconds(clock: Clock): number {
	const milliseconds = clock.now().getTime();
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new DeliverySafetyError();
	return milliseconds;
}

class DeliverySafetyError extends Error {
	constructor() {
		super("delivery arithmetic is unsafe");
		this.name = "DeliverySafetyError";
	}
}

function safeAddMilliseconds(left: number, right: number): number | null {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
	const result = left + right;
	return Number.isSafeInteger(result) ? result : null;
}
