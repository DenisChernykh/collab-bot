import { createHash } from "node:crypto";

import type {
	TelegramTransport,
	TelegramTransportRequest,
	TelegramTransportResponse,
} from "../../src/shared/application/ports/telegram-transport.js";
import { TelegramTransportError } from "../../src/shared/application/ports/telegram-transport.js";

export interface FakeTelegramCall {
	readonly method: TelegramTransportRequest["method"];
	readonly chatId: string;
	readonly messageId?: number;
	readonly textLength?: number;
	readonly textHash?: string;
}

type FakeOutcome =
	| { readonly kind: "success"; readonly messageId?: number }
	| { readonly kind: "failure"; readonly error: TelegramTransportError }
	| { readonly kind: "deferred"; readonly promise: Promise<TelegramTransportResponse> };

export class FakeTelegramTransport implements TelegramTransport {
	readonly calls: FakeTelegramCall[] = [];
	private readonly outcomes: FakeOutcome[] = [];

	enqueueSuccess(messageId = 1): void {
		this.outcomes.push({ kind: "success", messageId });
	}

	enqueueFailure(error: TelegramTransportError): void {
		this.outcomes.push({ kind: "failure", error });
	}

	enqueueDeferred(promise: Promise<TelegramTransportResponse>): void {
		this.outcomes.push({ kind: "deferred", promise });
	}

	async execute(request: TelegramTransportRequest): Promise<TelegramTransportResponse> {
		this.calls.push(toSafeCall(request));
		const outcome = this.outcomes.shift();
		if (outcome === undefined) {
			throw new TelegramTransportError({ code: "unknown" });
		}
		if (outcome.kind === "failure") {
			throw outcome.error;
		}
		if (outcome.kind === "success") {
			if (request.method === "send") {
				return { method: "send", messageId: outcome.messageId ?? 1 };
			}
			return { method: request.method };
		}
		return await withAbort(outcome.promise, request.signal);
	}
}

function toSafeCall(request: TelegramTransportRequest): FakeTelegramCall {
	if (request.method === "send") {
		return {
			method: request.method,
			chatId: request.chatId,
			textLength: request.text.length,
			textHash: createHash("sha256").update(request.text, "utf8").digest("hex"),
		};
	}
	if (request.method === "edit") {
		return {
			method: request.method,
			chatId: request.chatId,
			messageId: request.messageId,
			textLength: request.text.length,
			textHash: createHash("sha256").update(request.text, "utf8").digest("hex"),
		};
	}
	return { method: request.method, chatId: request.chatId, messageId: request.messageId };
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		return Promise.reject(signal.reason ?? new DOMException("aborted", "AbortError"));
	}
	return new Promise<T>((resolve, reject) => {
		const onAbort = (): void => {
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason ?? new DOMException("aborted", "AbortError"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
