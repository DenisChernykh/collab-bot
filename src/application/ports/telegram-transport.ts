export type TelegramTransportMethod = "send" | "edit" | "delete";

export interface TelegramSendRequest {
	readonly method: "send";
	readonly chatId: string;
	readonly text: string;
	readonly signal: AbortSignal;
}

export interface TelegramEditRequest {
	readonly method: "edit";
	readonly chatId: string;
	readonly messageId: number;
	readonly text: string;
	readonly signal: AbortSignal;
}

export interface TelegramDeleteRequest {
	readonly method: "delete";
	readonly chatId: string;
	readonly messageId: number;
	readonly signal: AbortSignal;
}

export type TelegramTransportRequest = TelegramSendRequest | TelegramEditRequest | TelegramDeleteRequest;

export type TelegramTransportResponse =
	| { readonly method: "send"; readonly messageId: number }
	| { readonly method: "edit" }
	| { readonly method: "delete" };

export type TelegramTransportFailureCode =
	| "rate_limited"
	| "forbidden"
	| "invalid_chat"
	| "not_found"
	| "message_not_modified"
	| "message_not_found"
	| "network"
	| "connection_lost"
	| "provider_timeout"
	| "unknown";

export type TelegramTransportFailurePhase = "pre_send" | "after_possible_send";

export class TelegramTransportError extends Error {
	readonly code: TelegramTransportFailureCode;
	readonly phase: TelegramTransportFailurePhase;
	readonly retryAfterSeconds: number | null;

	constructor(options: {
		readonly code: TelegramTransportFailureCode;
		readonly phase?: TelegramTransportFailurePhase;
		readonly retryAfterSeconds?: number;
	}) {
		super(`telegram transport failure: ${options.code}`);
		this.name = "TelegramTransportError";
		this.code = options.code;
		this.phase = options.phase ?? "pre_send";
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
	}
}

export interface TelegramTransport {
	execute(request: TelegramTransportRequest): Promise<TelegramTransportResponse>;
}
