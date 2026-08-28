import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";

import { composeBotApplication } from "../../src/runtime/bot-application.js";
import {
	createBotRuntimeLifecycle,
	type BotRuntimeLifecycleOperations,
} from "../../src/runtime/bot-lifecycle.js";
import type { DatabaseBoundary } from "../../src/platform/database/database-boundary.js";
import { FakeTelegramApi } from "../support/fake-telegram-api.js";
import { FakeClock } from "../support/fake-clock.js";

describe("R1-06B bot composition and lifecycle", () => {
	it("composes the object graph without migration, Telegram, worker, polling, drain, or close effects", () => {
		const fake = new FakeTelegramApi({
			token: "fake-token",
			botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe,
		});
		const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
		const start = vi.fn(async () => {});
		const stop = vi.fn(async () => {});
		bot.start = start;
		bot.stop = stop;
		const migrate = vi.fn(async () => {});
		const close = vi.fn(async () => {});
		const boundary = { close } as unknown as DatabaseBoundary;

		const application = composeBotApplication({
			bot,
			boundary,
			config: runtimeConfig,
			clock: new FakeClock(1_700_000_000_000),
			migrate,
		});

		expect(application.bot).toBe(bot);
		expect(application.boundary).toBe(boundary);
		expect(migrate).not.toHaveBeenCalled();
		expect(fake.calls).toEqual([]);
		expect(start).not.toHaveBeenCalled();
		expect(stop).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it("configures migration and identity without starting preflight, delivery, or polling", async () => {
		const events: string[] = [];
		const lifecycle = createBotRuntimeLifecycle(operations(events));

		await lifecycle.configure();

		expect(events).toEqual(["migrate", "identity"]);
	});

	it("cleans up once when polling start fails after preflight and worker invocation", async () => {
		const events: string[] = [];
		const failure = new Error("polling failed");
		const lifecycle = createBotRuntimeLifecycle(operations(events, {
			startPolling: async () => {
				events.push("poll:start");
				throw failure;
			},
		}));
		await lifecycle.configure();

		await expect(lifecycle.start()).rejects.toBe(failure);
		const stopped = lifecycle.stop();
		expect(lifecycle.shutdown()).toBe(stopped);
		await stopped;

		expect(events).toEqual([
			"migrate",
			"identity",
			"runtime_ready",
			"showcase_preflight",
			"worker:start",
			"poll:start",
			"worker:abort",
			"drain",
			"close",
		]);
	});

	it("shares stop and shutdown, then joins the worker before drain and close", async () => {
		const events: string[] = [];
		let finishPolling!: () => void;
		let finishWorker!: () => void;
		const polling = new Promise<void>((resolve) => { finishPolling = resolve; });
		const worker = new Promise<void>((resolve) => { finishWorker = resolve; });
		const lifecycle = createBotRuntimeLifecycle(operations(events, {
			runDeliveryWorker: (signal) => {
				events.push("worker:start");
				signal.addEventListener("abort", () => { events.push("worker:abort"); }, { once: true });
				return worker;
			},
			startPolling: async (onStarted) => {
				events.push("poll:start");
				onStarted();
				await polling;
			},
			stopPolling: async () => {
				events.push("poll:stop");
				finishPolling();
			},
		}));
		await lifecycle.configure();
		const starting = lifecycle.start();
		await flushMicrotasks();

		const stopping = lifecycle.stop();
		expect(lifecycle.stop()).toBe(stopping);
		expect(lifecycle.shutdown()).toBe(stopping);
		await flushMicrotasks();
		expect(events).toEqual([
			"migrate",
			"identity",
			"runtime_ready",
			"showcase_preflight",
			"worker:start",
			"poll:start",
			"poll_started",
			"worker:abort",
			"poll:stop",
		]);

		finishWorker();
		await stopping;
		await starting;
		expect(events.slice(-2)).toEqual(["drain", "close"]);
		await expect(lifecycle.start()).rejects.toThrow(/cannot start/i);
	});

	it("stops before start without polling and closes resources only once", async () => {
		const events: string[] = [];
		const lifecycle = createBotRuntimeLifecycle(operations(events));
		await lifecycle.configure();

		const stopped = lifecycle.stop();
		expect(lifecycle.shutdown()).toBe(stopped);
		await stopped;
		await lifecycle.stop();

		expect(events).toEqual(["migrate", "identity", "drain", "close"]);
		await expect(lifecycle.start()).rejects.toThrow(/cannot start/i);
	});
});

function operations(
	events: string[],
	overrides: Partial<BotRuntimeLifecycleOperations> = {},
): BotRuntimeLifecycleOperations {
	return {
		migrate: async () => { events.push("migrate"); },
		initializeIdentity: async () => { events.push("identity"); },
		preflightShowcase: async () => { events.push("showcase_preflight"); },
		runDeliveryWorker: async (signal) => {
			events.push("worker:start");
			if (signal.aborted) return;
			await new Promise<void>((resolve) => {
				signal.addEventListener("abort", () => {
					events.push("worker:abort");
					resolve();
				}, { once: true });
			});
		},
		startPolling: async (onStarted) => {
			events.push("poll:start");
			onStarted();
		},
		stopPolling: async () => { events.push("poll:stop"); },
		drainUpdates: async () => { events.push("drain"); },
		closeResources: async () => { events.push("close"); },
		onRuntimeReady: () => { events.push("runtime_ready"); },
		onPollingStarted: () => { events.push("poll_started"); },
		onPollingStopFailed: () => { events.push("poll_stop_failed"); },
		...overrides,
	};
}

const runtimeConfig = {
	botToken: "fake-token",
	expectedBotId: "777",
	expectedBotUsername: "collab_bot",
	adminTelegramIds: [] as readonly string[],
	showcaseChannelId: "-1001",
	showcaseChannelUsername: "showcase",
	databasePath: "/private/app.sqlite",
	logLevel: "info" as const,
	timeZone: "Asia/Yekaterinburg" as const,
	helpContact: "@helpdesk",
};

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
