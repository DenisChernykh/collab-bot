export interface BotRuntimeLifecycleOperations {
	readonly migrate: () => Promise<void>;
	readonly initializeIdentity: () => Promise<void>;
	readonly preflightShowcase: () => Promise<void>;
	readonly runDeliveryWorker: (signal: AbortSignal) => Promise<void>;
	readonly startPolling: (onStarted: () => void) => Promise<void>;
	readonly stopPolling: () => Promise<void>;
	readonly drainUpdates: () => Promise<void>;
	readonly closeResources: () => Promise<void>;
	readonly onRuntimeReady: () => void;
	readonly onPollingStarted: () => void;
	readonly onPollingStopFailed: (error: unknown) => void;
}

export interface BotRuntimeLifecycle {
	readonly configure: () => Promise<void>;
	readonly start: () => Promise<void>;
	readonly stop: () => Promise<void>;
	readonly shutdown: () => Promise<void>;
}

type LifecycleState = "unconfigured" | "configuring" | "ready" | "starting" | "running" | "failed" | "stopping" | "stopped";

export function createBotRuntimeLifecycle(operations: BotRuntimeLifecycleOperations): BotRuntimeLifecycle {
	let lifecycle: LifecycleState = "unconfigured";
	const deliveryAbortController = new AbortController();
	let deliveryWorkerPromise: Promise<void> | undefined;
	let stopPromise: Promise<void> | undefined;

	const stop = (): Promise<void> => {
		if (stopPromise !== undefined) return stopPromise;
		const shouldStopPolling = lifecycle === "starting" || lifecycle === "running";
		lifecycle = "stopping";
		stopPromise = (async () => {
			deliveryAbortController.abort();
			if (shouldStopPolling) {
				try {
					await operations.stopPolling();
				} catch (error) {
					operations.onPollingStopFailed(error);
				}
			}
			if (deliveryWorkerPromise !== undefined) await deliveryWorkerPromise;
			await operations.drainUpdates();
			await operations.closeResources();
			lifecycle = "stopped";
		})();
		return stopPromise;
	};

	const configure = async (): Promise<void> => {
		if (lifecycle !== "unconfigured") throw new Error("bot runtime cannot configure more than once");
		lifecycle = "configuring";
		try {
			await operations.migrate();
			await operations.initializeIdentity();
			lifecycle = "ready";
		} catch (error) {
			lifecycle = "failed";
			throw error;
		}
	};

	const start = async (): Promise<void> => {
		if (lifecycle !== "ready") {
			throw new Error("bot runtime cannot start after shutdown or a previous start");
		}
		lifecycle = "starting";
		operations.onRuntimeReady();
		try {
			await operations.preflightShowcase();
			if (lifecycle !== "starting") {
				throw new Error("bot runtime cannot start after shutdown or a previous start");
			}
			deliveryWorkerPromise = operations.runDeliveryWorker(deliveryAbortController.signal);
			await operations.startPolling(() => {
				if (lifecycle === "starting") lifecycle = "running";
				operations.onPollingStarted();
			});
			if (lifecycle === "starting") lifecycle = "running";
		} catch (error) {
			lifecycle = "failed";
			await stop();
			throw error;
		}
	};

	return { configure, start, stop, shutdown: stop };
}
