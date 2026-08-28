import { describe, expect, it, vi } from "vitest";

import { DeliveryWorker, type DeliveryWorkerSteps } from "../../src/runtime/lifecycle/delivery-worker.js";

describe("R1-06A delivery worker lifecycle", () => {
	it("runs the exact startup and cycle order, then wakes the 250ms delay on abort", async () => {
		const events: string[] = [];
		const timeout = vi.spyOn(globalThis, "setTimeout");
		const controller = new AbortController();
		const runOnce = vi.fn(async () => { events.push("deliver"); });
		const worker = new DeliveryWorker(steps(events, { runOnce }));

		const running = worker.run(controller.signal);
		await flushMicrotasks();

		expect(events).toEqual(["recover", "project_terminal", "cancel_expired", "supersede_stale", "deliver"]);
		expect(runOnce).toHaveBeenCalledWith();
		expect(timeout.mock.calls.some((call) => call[1] === 250)).toBe(true);
		controller.abort();
		await expect(running).resolves.toBeUndefined();
		expect(events).toEqual(["recover", "project_terminal", "cancel_expired", "supersede_stale", "deliver"]);
		timeout.mockRestore();
	});

	it("does no startup work for a pre-aborted signal and finishes an in-flight step before stopping", async () => {
		const preAbortedEvents: string[] = [];
		const preAborted = new AbortController();
		preAborted.abort();
		await new DeliveryWorker(steps(preAbortedEvents)).run(preAborted.signal);
		expect(preAbortedEvents).toEqual([]);

		const events: string[] = [];
		let enterProjection!: () => void;
		let releaseProjection!: () => void;
		const projectionEntered = new Promise<void>((resolve) => { enterProjection = resolve; });
		const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
		const controller = new AbortController();
		const worker = new DeliveryWorker(steps(events, {
			projectTerminalOutcomes: async () => {
				events.push("project_terminal:start");
				enterProjection();
				await projectionGate;
				events.push("project_terminal:end");
			},
		}));
		let settled = false;
		const running = worker.run(controller.signal).then(() => { settled = true; });
		await projectionEntered;
		controller.abort();
		await flushMicrotasks();
		expect(settled).toBe(false);
		releaseProjection();
		await running;
		expect(events).toEqual(["recover", "project_terminal:start", "project_terminal:end"]);
	});

	it("checks the signal between cycle steps without passing it into delivery", async () => {
		const events: string[] = [];
		const controller = new AbortController();
		const runOnce = vi.fn(async () => { events.push("deliver"); });
		const worker = new DeliveryWorker(steps(events, {
			cancelExpiredPrepared: async () => {
				events.push("cancel_expired");
				controller.abort();
			},
			runOnce,
		}));

		await worker.run(controller.signal);

		expect(events).toEqual(["recover", "project_terminal", "cancel_expired"]);
		expect(runOnce).not.toHaveBeenCalled();
	});

	it("rejects a second concurrent run and allows the first in-flight step to finish", async () => {
		const events: string[] = [];
		let enterRecovery!: () => void;
		let releaseRecovery!: () => void;
		const recoveryEntered = new Promise<void>((resolve) => { enterRecovery = resolve; });
		const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
		const firstController = new AbortController();
		const worker = new DeliveryWorker(steps(events, {
			recoverStale: async () => {
				events.push("recover:start");
				enterRecovery();
				await recoveryGate;
				events.push("recover:end");
			},
		}));
		const first = worker.run(firstController.signal);
		await recoveryEntered;

		await expect(worker.run(new AbortController().signal)).rejects.toThrow(/already running/i);
		firstController.abort();
		releaseRecovery();
		await first;
		expect(events).toEqual(["recover:start", "recover:end"]);
	});
});

function steps(events: string[], overrides: Partial<DeliveryWorkerSteps> = {}): DeliveryWorkerSteps {
	return {
		canPublish: () => true,
		recoverStale: async () => { events.push("recover"); },
		projectTerminalOutcomes: async () => { events.push("project_terminal"); },
		cancelExpiredPrepared: async () => { events.push("cancel_expired"); },
		supersedeStaleProjections: async () => { events.push("supersede_stale"); },
		runOnce: async () => { events.push("deliver"); },
		...overrides,
	};
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
