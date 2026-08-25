import {
	ProviderDeadlineExceededError,
	ProviderShutdownAbortError,
	PROVIDER_DEADLINE_MS,
	type ProviderDeadline,
} from "../../application/ports/provider-deadline.js";

export class SystemProviderDeadline implements ProviderDeadline {
	run<T>(shutdownSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		let timedOut = false;
		let shutdownRequested = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let removeShutdownListener: (() => void) | undefined;
		const operationPromise = Promise.resolve().then(() => operation(controller.signal));
		void operationPromise.catch(() => undefined);
		const deadlinePromise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				controller.abort();
				reject(new ProviderDeadlineExceededError());
			}, PROVIDER_DEADLINE_MS);
		});
		let rejectShutdown: ((reason: ProviderShutdownAbortError) => void) | undefined;
		const shutdownPromise = new Promise<never>((_, reject) => {
			rejectShutdown = reject;
		});
		if (shutdownSignal !== undefined) {
			const onShutdown = (): void => {
				shutdownRequested = true;
				const error = new ProviderShutdownAbortError();
				controller.abort(error);
				rejectShutdown?.(error);
			};
			if (shutdownSignal.aborted) onShutdown();
			else {
				shutdownSignal.addEventListener("abort", onShutdown, { once: true });
				removeShutdownListener = () => shutdownSignal.removeEventListener("abort", onShutdown);
			}
		}
		const promises: Promise<unknown>[] = [operationPromise, deadlinePromise];
		if (shutdownSignal !== undefined) promises.push(shutdownPromise);
		return Promise.race(promises).catch((error: unknown) => {
			if (timedOut) throw new ProviderDeadlineExceededError();
			if (shutdownRequested) throw new ProviderShutdownAbortError();
			throw error;
		}).finally(() => {
			if (timer !== undefined) clearTimeout(timer);
			removeShutdownListener?.();
		}) as Promise<T>;
	}
}
