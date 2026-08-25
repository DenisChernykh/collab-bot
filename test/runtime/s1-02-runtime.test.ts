import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { chmod, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bot, type PollingOptions } from "grammy";
import type { UserFromGetMe } from "grammy/types";

import { assertBotIdentity, assertPrivateEnvFile, ALLOWED_UPDATES, createBotRuntime, ensurePrivateDatabasePath } from "../../src/runtime/bot-runtime.js";
import { FakeTelegramApi } from "../../src/infrastructure/testing/fake-telegram-api.js";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("S1-02 runtime invariants", () => {
	it("keeps the polling allowlist and exact identity comparison", () => {
		expect(ALLOWED_UPDATES).toEqual(["message", "callback_query"]);
		expect(() => assertBotIdentity({ id: 777, username: "collab_bot" }, { expectedBotId: "777", expectedBotUsername: "collab_bot" })).not.toThrow();
		expect(() => assertBotIdentity({ id: 778, username: "collab_bot" }, { expectedBotId: "777", expectedBotUsername: "collab_bot" })).toThrow(/identity/i);
		expect(() => assertBotIdentity({ id: 777, username: "other_bot" }, { expectedBotId: "777", expectedBotUsername: "collab_bot" })).toThrow(/identity/i);
	});

	it("migrates before getMe, starts with the allowlist, and drains one-shot shutdown", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-runtime-"));
		const fake = new FakeTelegramApi({ token: "fake-token", botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe });
		const bot = new Bot("fake-token", { client: { fetch: fake.fetch } });
		let startOptions: PollingOptions | undefined;
		let stopCalls = 0;
		bot.start = async (options?: PollingOptions) => { startOptions = options; (options?.onStart as (() => void) | undefined)?.(); };
		bot.stop = async () => { stopCalls += 1; };
		try {
			const runtime = await createBotRuntime({
				bot,
				config: {
					botToken: "fake-token", expectedBotId: "777", expectedBotUsername: "collab_bot", adminTelegramIds: [],
					showcaseChannelId: "-1001", showcaseChannelUsername: "showcase", databasePath: join(directory, "app.sqlite"),
					logLevel: "info", timeZone: "Asia/Yekaterinburg", helpContact: "@helpdesk",
				},
				migrationsDirectory,
			});
			expect(fake.calls.map((call) => call.method)).toEqual(["getMe"]);
				await runtime.start();
				expect(startOptions?.allowed_updates).toEqual(["message", "callback_query"]);
			await runtime.shutdown();
			await runtime.shutdown();
			expect(stopCalls).toBe(1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("creates and accepts only private current-user database paths", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-db-"));
		const databasePath = join(directory, "app.sqlite");
		const existingPath = join(directory, "existing.sqlite");
		const linkPath = join(directory, "link.sqlite");
		try {
			await ensurePrivateDatabasePath(databasePath);
			expect((await stat(databasePath)).mode & 0o777).toBe(0o600);
			await writeFile(existingPath, "not-a-database", "utf8");
			await chmod(existingPath, 0o600);
			await expect(ensurePrivateDatabasePath(existingPath)).resolves.toBeUndefined();
			await chmod(existingPath, 0o644);
			await expect(ensurePrivateDatabasePath(existingPath)).rejects.toThrow(/0600/);
			await symlink(existingPath, linkPath);
			await expect(ensurePrivateDatabasePath(linkPath)).rejects.toThrow(/regular file/);
			await chmod(directory, 0o755);
			await expect(ensurePrivateDatabasePath(join(directory, "other.sqlite"))).rejects.toThrow(/0700/);
		} finally {
			await chmod(directory, 0o700);
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("forbids polling after signal-before-start and drains a blocking update", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-lifecycle-"));
		const fake = new FakeTelegramApi({ token: "fake-token", botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe });
		try {
			const beforeStart = await createBotRuntime({ bot: new Bot("fake-token", { client: { fetch: fake.fetch } }), config: runtimeConfig(join(directory, "before.sqlite")), migrationsDirectory });
			await beforeStart.shutdown();
			await expect(beforeStart.start()).rejects.toThrow(/cannot start/);

			const pollingBot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			let startResolve: (() => void) | undefined;
			let stopCalls = 0;
			pollingBot.start = async (options?: PollingOptions) => {
				(options?.onStart as (() => void) | undefined)?.();
				await new Promise<void>((resolve) => { startResolve = resolve; });
			};
			pollingBot.stop = async () => { stopCalls += 1; startResolve?.(); };
			const pollingRuntime = await createBotRuntime({ bot: pollingBot, config: runtimeConfig(join(directory, "polling.sqlite")), migrationsDirectory });
			const started = pollingRuntime.start();
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			await pollingRuntime.shutdown();
			await started;
			expect(stopCalls).toBe(1);
			await expect(pollingRuntime.start()).rejects.toThrow(/cannot start/);

			const secondBot = new Bot("fake-token", { client: { fetch: fake.fetch } });
			let releaseUpdate!: () => void;
			let entered!: () => void;
			const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
			const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
			const secondRuntime = await createBotRuntime({ bot: secondBot, config: runtimeConfig(join(directory, "second.sqlite")), migrationsDirectory });
			const originalQuery = secondRuntime.boundary.query.bind(secondRuntime.boundary) as (sql: string, parameters?: readonly (null | number | bigint | string | NodeJS.ArrayBufferView)[]) => Promise<readonly unknown[]>;
			(secondRuntime.boundary as unknown as { query: (sql: string, parameters?: readonly (null | number | bigint | string | NodeJS.ArrayBufferView)[]) => Promise<readonly unknown[]> }).query = async (sql, parameters) => {
				entered();
				await updateGate;
				return originalQuery(sql, parameters);
			};
			const update = secondRuntime.bot.handleUpdate({ update_id: 801, message: { message_id: 1, date: 1_700_000_000, chat: { id: 100, type: "private", first_name: "Alice" }, from: { id: 100, is_bot: false, first_name: "Alice" }, text: "/help" } });
			await enteredPromise;
			let drained = false;
			const draining = secondRuntime.shutdown().then(() => { drained = true; });
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			expect(drained).toBe(false);
			releaseUpdate();
			await update;
			await draining;
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("requires an explicit regular 0600 env file and rejects symlinks", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-env-"));
		const envPath = join(directory, ".env.bot");
		const linkPath = join(directory, "link.env");
		try {
			await writeFile(envPath, "BOT_TOKEN=fake-token\n", "utf8");
			await chmod(envPath, 0o600);
			await expect(assertPrivateEnvFile(envPath)).resolves.toBeUndefined();
			await chmod(envPath, 0o644);
			await expect(assertPrivateEnvFile(envPath)).rejects.toThrow(/0600/);
			await symlink(envPath, linkPath);
			await expect(assertPrivateEnvFile(linkPath)).rejects.toThrow(/regular file/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("closes safely when polling fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "collaboration-s1-02-poll-failure-"));
		const bot = new Bot("fake-token", { client: { fetch: new FakeTelegramApi({ token: "fake-token", botInfo: { id: 777, is_bot: true, first_name: "Collab", username: "collab_bot" } as unknown as UserFromGetMe }).fetch } });
		bot.start = async () => { throw new Error("polling failed"); };
		try {
			const runtime = await createBotRuntime({ bot, config: runtimeConfig(join(directory, "app.sqlite")), migrationsDirectory });
			await expect(runtime.start()).rejects.toThrow("polling failed");
			await expect(runtime.shutdown()).resolves.toBeUndefined();
			await expect(runtime.start()).rejects.toThrow(/cannot start/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

function runtimeConfig(databasePath: string) {
	return {
		botToken: "fake-token", expectedBotId: "777", expectedBotUsername: "collab_bot", adminTelegramIds: [],
		showcaseChannelId: "-1001", showcaseChannelUsername: "showcase", databasePath,
		logLevel: "info" as const, timeZone: "Asia/Yekaterinburg", helpContact: "@helpdesk",
	} as const;
}
