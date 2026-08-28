export const DELIVERY_WORKER_DELAY_MS = 250;

export interface DeliveryWorkerSteps {
	readonly canPublish: () => boolean;
	readonly recoverStale: () => Promise<unknown>;
	readonly projectTerminalOutcomes: () => Promise<unknown>;
	readonly cancelExpiredPrepared: () => Promise<unknown>;
	readonly supersedeStaleProjections: () => Promise<unknown>;
	readonly runOnce: () => Promise<unknown>;
}

export class DeliveryWorker {
	private running = false;

	constructor(private readonly steps: DeliveryWorkerSteps) {}

	async run(signal: AbortSignal): Promise<void> {
		if (this.running) throw new Error("delivery worker is already running");
		this.running = true;
		try {
			if (signal.aborted) return;
			await this.steps.recoverStale();
			if (signal.aborted) return;
			await this.steps.projectTerminalOutcomes();
			if (signal.aborted) return;

			while (!signal.aborted) {
				if (this.steps.canPublish()) {
					await this.steps.cancelExpiredPrepared();
					if (signal.aborted) return;
				}
				if (signal.aborted) return;
				await this.steps.supersedeStaleProjections();
				if (signal.aborted) return;
				await this.steps.runOnce();
				if (signal.aborted) return;
				await waitForNextCycle(signal);
			}
		} finally {
			this.running = false;
		}
	}
}

async function waitForNextCycle(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return;
	await new Promise<void>((resolve) => {
		const finish = (): void => {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, DELIVERY_WORKER_DELAY_MS);
		(timer as unknown as { unref?: () => void }).unref?.();
		signal.addEventListener("abort", finish, { once: true });
		if (signal.aborted) finish();
	});
}
