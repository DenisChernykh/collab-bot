export const PROVIDER_DEADLINE_MS = 15_000;

export class ProviderDeadlineExceededError extends Error {
	constructor() {
		super("provider deadline exceeded");
		this.name = "ProviderDeadlineExceededError";
	}
}

export class ProviderShutdownAbortError extends Error {
	constructor() {
		super("provider operation aborted by shutdown");
		this.name = "ProviderShutdownAbortError";
	}
}

export interface ProviderDeadline {
	run<T>(shutdownSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
