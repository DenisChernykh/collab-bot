export type BotProcessSignal = "SIGINT" | "SIGTERM";

export interface BotProcessSignalSource {
	readonly once: (signal: BotProcessSignal, listener: () => void) => void;
	readonly off: (signal: BotProcessSignal, listener: () => void) => void;
}

export interface StartStopBotRuntime {
	readonly start: () => Promise<void>;
	readonly stop: () => Promise<void>;
}

export async function runBotProcess(runtime: StartStopBotRuntime, signals: BotProcessSignalSource): Promise<void> {
	let stopPromise: Promise<void> | undefined;
	const requestStop = (): Promise<void> => {
		stopPromise ??= runtime.stop();
		return stopPromise;
	};
	const onSignal = (): void => {
		void requestStop().catch(() => undefined);
	};

	signals.once("SIGINT", onSignal);
	signals.once("SIGTERM", onSignal);
	try {
		await runtime.start();
	} finally {
		try {
			await requestStop();
		} finally {
			signals.off("SIGINT", onSignal);
			signals.off("SIGTERM", onSignal);
		}
	}
}
