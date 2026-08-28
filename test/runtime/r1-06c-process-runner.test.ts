import { describe, expect, it, vi } from "vitest";

import {
	runBotProcess,
	type BotProcessSignal,
	type BotProcessSignalSource,
} from "../../src/runtime/lifecycle/process-runner.js";
import {
	createBotRuntimeLifecycle,
	type BotRuntimeLifecycleOperations,
} from "../../src/runtime/lifecycle/bot-lifecycle.js";

describe("R1-06C process runner", () => {
	it("stops once and preserves start-after-stop failure when a signal arrives immediately after subscription", async () => {
		const signals = new FakeSignalSource();
		const events: string[] = [];
		const lifecycle = createBotRuntimeLifecycle(lifecycleOperations(events));
		await lifecycle.configure();
		const start = vi.fn(lifecycle.start);
		const stop = vi.fn(lifecycle.stop);
		signals.afterSubscribed = () => { signals.emit("SIGINT"); };

		await expect(runBotProcess({ start, stop }, signals)).rejects.toThrow(/cannot start after shutdown/i);

		expect(start).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
		expect(events).toEqual(["migrate", "identity", "drain", "close"]);
		expect(signals.listenerCount()).toBe(0);
	});

	it("does not start worker or polling when a signal stops lifecycle during preflight", async () => {
		const signals = new FakeSignalSource();
		const events: string[] = [];
		let enterPreflight!: () => void;
		let releasePreflight!: () => void;
		let finishStop!: () => void;
		const preflightEntered = new Promise<void>((resolve) => { enterPreflight = resolve; });
		const preflightGate = new Promise<void>((resolve) => { releasePreflight = resolve; });
		const stopped = new Promise<void>((resolve) => { finishStop = resolve; });
		const lifecycle = createBotRuntimeLifecycle(lifecycleOperations(events, {
			preflightShowcase: async () => {
				events.push("preflight:start");
				enterPreflight();
				await preflightGate;
				events.push("preflight:end");
			},
			closeResources: async () => {
				events.push("close");
				finishStop();
			},
		}));
		await lifecycle.configure();
		const stop = vi.fn(lifecycle.stop);

		const processRun = runBotProcess({ start: lifecycle.start, stop }, signals);
		await preflightEntered;
		signals.emit("SIGTERM");
		await stopped;
		releasePreflight();

		await expect(processRun).rejects.toThrow(/cannot start after shutdown/i);
		expect(stop).toHaveBeenCalledTimes(1);
		expect(events).not.toContain("worker:start");
		expect(events).not.toContain("poll:start");
		expect(signals.listenerCount()).toBe(0);
	});

	it("shares one stop across SIGINT, SIGTERM, and final cleanup after start", async () => {
		const signals = new FakeSignalSource();
		let startEntered!: () => void;
		let finishStart!: () => void;
		const entered = new Promise<void>((resolve) => { startEntered = resolve; });
		const running = new Promise<void>((resolve) => { finishStart = resolve; });
		const start = vi.fn(async () => {
			startEntered();
			await running;
		});
		const stop = vi.fn(async () => { finishStart(); });

		const processRun = runBotProcess({ start, stop }, signals);
		await entered;
		signals.emit("SIGINT");
		signals.emit("SIGTERM");
		await processRun;

		expect(start).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
		expect(signals.listenerCount()).toBe(0);
	});

	it("final-stops after start failure and preserves that failure", async () => {
		const signals = new FakeSignalSource();
		const failure = new Error("start failed");
		const stop = vi.fn(async () => {});

		await expect(runBotProcess({ start: async () => { throw failure; }, stop }, signals)).rejects.toBe(failure);

		expect(stop).toHaveBeenCalledTimes(1);
		expect(signals.listenerCount()).toBe(0);
	});

	it("awaits and propagates stop failure without leaving signal listeners", async () => {
		const signals = new FakeSignalSource();
		const failure = new Error("stop failed");

		await expect(runBotProcess({ start: async () => {}, stop: async () => { throw failure; } }, signals)).rejects.toBe(failure);

		expect(signals.listenerCount()).toBe(0);
	});
});

function lifecycleOperations(
	events: string[],
	overrides: Partial<BotRuntimeLifecycleOperations> = {},
): BotRuntimeLifecycleOperations {
	return {
		migrate: async () => { events.push("migrate"); },
		initializeIdentity: async () => { events.push("identity"); },
		preflightShowcase: async () => { events.push("preflight"); },
		runDeliveryWorker: async () => { events.push("worker:start"); },
		startPolling: async () => { events.push("poll:start"); },
		stopPolling: async () => { events.push("poll:stop"); },
		drainUpdates: async () => { events.push("drain"); },
		closeResources: async () => { events.push("close"); },
		onRuntimeReady: () => { events.push("runtime:ready"); },
		onPollingStarted: () => { events.push("poll:started"); },
		onPollingStopFailed: () => { events.push("poll:stop-failed"); },
		...overrides,
	};
}

class FakeSignalSource implements BotProcessSignalSource {
	readonly listeners = new Map<BotProcessSignal, Set<() => void>>();
	afterSubscribed: (() => void) | undefined;

	once(signal: BotProcessSignal, listener: () => void): void {
		const listeners = this.listeners.get(signal) ?? new Set<() => void>();
		listeners.add(listener);
		this.listeners.set(signal, listeners);
		if (this.listenerCount() === 2) this.afterSubscribed?.();
	}

	off(signal: BotProcessSignal, listener: () => void): void {
		this.listeners.get(signal)?.delete(listener);
	}

	emit(signal: BotProcessSignal): void {
		const listeners = [...(this.listeners.get(signal) ?? [])];
		for (const listener of listeners) {
			this.off(signal, listener);
			listener();
		}
	}

	listenerCount(): number {
		return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
	}
}
