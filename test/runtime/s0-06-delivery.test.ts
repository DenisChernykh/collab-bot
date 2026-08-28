import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
	OutboxDeliveryService,
	} from "../../src/shared/application/outbox/outbox-service.js";
import { DeliveryRunner } from "../../src/shared/application/outbox/delivery-runner.js";
import {
	PROVIDER_DEADLINE_MS,
	ProviderDeadlineExceededError,
	ProviderShutdownAbortError,
	type ProviderDeadline,
} from "../../src/shared/application/ports/provider-deadline.js";
import {
	TelegramTransportError,
	type TelegramTransportResponse,
} from "../../src/shared/application/ports/telegram-transport.js";
import type { ClaimTokenGenerator } from "../../src/shared/application/ports/claim-token.js";
import type { Clock } from "../../src/shared/application/ports/clock.js";
import { DatabaseBoundary } from "../../src/infrastructure/database/database-boundary.js";
import { MigrationRunner, MigrationSource } from "../../src/infrastructure/database/migrations.js";
import { SqliteOutboxDeliveryRepository } from "../../src/infrastructure/database/outbox-delivery-repository.js";
import { DatabaseBoundaryTransactionRunner } from "../../src/infrastructure/database/transaction-runner.js";
import { FakeTelegramTransport } from "../support/fake-telegram-transport.js";
import { FakeClock } from "../support/fake-clock.js";
import { SystemProviderDeadline } from "../../src/infrastructure/time/provider-deadline.js";

const migrationsPath = fileURLToPath(new URL("../../migrations/", import.meta.url));
const sendPayload = { version: 1 as const, method: "send" as const, text: "runtime synthetic body" };
const DAY_MS = 24 * 60 * 60 * 1000;

class FixedClaimTokens implements ClaimTokenGenerator {
	private index = 0;

	generate(): string {
		this.index += 1;
		return `claim-${this.index}`;
	}
}

class StaticClock implements Clock {
	constructor(private readonly milliseconds: number) {}

	now(): Date {
		return { getTime: () => this.milliseconds } as Date;
	}
}

class ImmediateDeadline implements ProviderDeadline {
	run<T>(_shutdownSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return operation(new AbortController().signal);
	}
}

class FailingDeadline implements ProviderDeadline {
	run<T>(): Promise<T> {
		return Promise.reject(new ProviderDeadlineExceededError());
	}
}

async function withRuntime<T>(work: (context: RuntimeContext) => Promise<T>, deadline: ProviderDeadline = new ImmediateDeadline()): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "collaboration-s0-06-runtime-"));
	const migrationDirectory = join(directory, "migrations");
	await mkdir(migrationDirectory);
	for (const filename of ["0001_s0-04-ingress-foundation.sql", "0002_s0-05-outbox-events.sql"]) {
		await copyFile(join(migrationsPath, filename), join(migrationDirectory, filename));
	}
	const boundary = new DatabaseBoundary(join(directory, "app.sqlite"));
	const clock = new FakeClock(DAY_MS);
	try {
		const source = await MigrationSource.fromDirectory(migrationDirectory);
		const migrations = new MigrationRunner(source, clock);
		expect((await migrations.migrate(boundary)).applied).toEqual([1, 2]);
		await migrations.verify(boundary);
		const repository = new SqliteOutboxDeliveryRepository(boundary);
		const outbox = new OutboxDeliveryService(repository, new DatabaseBoundaryTransactionRunner(boundary), clock);
		const transport = new FakeTelegramTransport();
		const runner = new DeliveryRunner(repository, transport, deadline, new FixedClaimTokens(), clock);
		return await work({ boundary, clock, outbox, repository, runner, transport });
	} finally {
		await boundary.close();
		await rm(directory, { recursive: true, force: true });
	}
}

interface RuntimeContext {
	readonly boundary: DatabaseBoundary;
	readonly clock: FakeClock;
	readonly outbox: OutboxDeliveryService;
	readonly repository: SqliteOutboxDeliveryRepository;
	readonly runner: DeliveryRunner;
	readonly transport: FakeTelegramTransport;
}

async function seedSend(outbox: OutboxDeliveryService, id: string, key: string, recipient = "123"): Promise<void> {
	await outbox.create({ id, idempotencyKey: key, kind: "dm_send", recipientChatId: recipient, payload: sendPayload });
}

describe("S0-06 Telegram transport and delivery runner", () => {
	it("does not recover or claim when shutdown is already requested", async () => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			const id = "0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a";
			await seedSend(outbox, id, "runtime.shutdown.pre-aborted");
			const shutdown = new AbortController();
			shutdown.abort();

			expect(await runner.runOnce(shutdown.signal)).toEqual({ outcome: "shutdown" });
			expect(await outbox.findById(id)).toMatchObject({ status: "prepared", attemptCount: 0 });
			expect(transport.calls).toHaveLength(0);
		});
	});

	it("does not claim a queued run after shutdown while another provider call is in flight", async () => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			const firstId = "0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b";
			const secondId = "0c0c0c0c-0c0c-40c0-80c0-0c0c0c0c0c0c";
			await seedSend(outbox, firstId, "runtime.shutdown.queued.first");
			await seedSend(outbox, secondId, "runtime.shutdown.queued.second");
			let resolveDeferred!: (response: TelegramTransportResponse) => void;
			transport.enqueueDeferred(new Promise<TelegramTransportResponse>((resolve) => { resolveDeferred = resolve; }));
			const first = runner.runOnce();
			await new Promise<void>((resolve) => setImmediate(resolve));
			const shutdown = new AbortController();
			shutdown.abort();
			const second = runner.runOnce(shutdown.signal);
			resolveDeferred({ method: "send", messageId: 100 });

			expect(await first).toMatchObject({ outcome: "sent" });
			expect(await second).toEqual({ outcome: "shutdown" });
			expect(await outbox.findById(secondId)).toMatchObject({ status: "prepared", attemptCount: 0 });
			expect(transport.calls).toHaveLength(1);
		});
	});

	it("does not claim a scheduled prepared intent before its due time", async () => {
		await withRuntime(async ({ clock, outbox, runner, transport }) => {
			const id = "10101010-1010-4010-8010-101010101010";
			const notBeforeAt = clock.now().getTime() + 5_000;
			await outbox.create({ id, idempotencyKey: "runtime.scheduled.due", kind: "dm_send", recipientChatId: "123", notBeforeAt, payload: sendPayload });
			transport.enqueueSuccess(92);

			expect(await runner.runOnce()).toMatchObject({ outcome: "idle" });
			expect(transport.calls).toHaveLength(0);
			expect(await outbox.findById(id)).toMatchObject({ status: "prepared", nextAttemptAt: notBeforeAt });

			clock.advanceBy(5_000);
			expect(await runner.runOnce()).toMatchObject({ outcome: "sent" });
			expect(transport.calls).toHaveLength(1);
		});
	});

	it("fake Bot API success dispatches a prepared send with safe call metadata and stores the returned message ID", async () => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			await seedSend(outbox, "11111111-1111-4111-8111-111111111111", "runtime.send.success");
			transport.enqueueSuccess(91);

			expect(await runner.runOnce()).toMatchObject({ outcome: "sent" });
			expect(transport.calls[0]).toMatchObject({ method: "send", chatId: "123", textLength: sendPayload.text.length });
			expect(transport.calls[0]).not.toHaveProperty("text");
			expect(JSON.stringify(transport.calls)).not.toContain(sendPayload.text);
			expect(await outbox.findById("11111111-1111-4111-8111-111111111111")).toMatchObject({ status: "sent", messageId: 91 });
		});
	});

	it("429 retry_after and pre-send network failures use bounded due times", async () => {
		await withRuntime(async ({ clock, outbox, runner, transport }) => {
			await seedSend(outbox, "22222222-2222-4222-8222-222222222222", "runtime.send.rate-limit");
			await seedSend(outbox, "33333333-3333-4333-8333-333333333333", "runtime.send.network");
			transport.enqueueFailure(new TelegramTransportError({ code: "rate_limited", retryAfterSeconds: 7 }));
			transport.enqueueFailure(new TelegramTransportError({ code: "network", phase: "pre_send" }));

			expect(await runner.runOnce()).toMatchObject({ outcome: "retryable_failed" });
			const rateLimited = await outbox.findById("22222222-2222-4222-8222-222222222222");
			expect(rateLimited).toMatchObject({ status: "retryable_failed", telegramRetryAfter: 7, lastErrorKind: "rate_limited" });
			expect(rateLimited?.nextAttemptAt).toBeGreaterThanOrEqual(clock.now().getTime() + 7_000);

			expect(await runner.runOnce()).toMatchObject({ outcome: "retryable_failed" });
			expect(await outbox.findById("33333333-3333-4333-8333-333333333333")).toMatchObject({ status: "retryable_failed", lastErrorKind: "network" });
		});
	});

	it.each([
		["forbidden", "forbidden"],
		["invalid_chat", "invalid_chat"],
		["not_found", "not_found"],
	] as const)("makes known permanent failure %s terminal", async (code, errorKind) => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			const id = "44444444-4444-4444-8444-444444444444";
			await seedSend(outbox, id, `runtime.permanent.${code}`);
			transport.enqueueFailure(new TelegramTransportError({ code }));
			expect(await runner.runOnce()).toMatchObject({ outcome: "permanent_failed" });
			expect(await outbox.findById(id)).toMatchObject({ status: "permanent_failed", lastErrorKind: errorKind });
		});
	});

	it("never retries ambiguous send outcomes", async () => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			const id = "55555555-5555-4555-8555-555555555555";
			await seedSend(outbox, id, "runtime.send.ambiguous");
			transport.enqueueFailure(new TelegramTransportError({ code: "connection_lost", phase: "after_possible_send" }));
			expect(await runner.runOnce()).toMatchObject({ outcome: "ambiguous" });
			expect(await runner.runOnce()).toMatchObject({ outcome: "idle" });
			expect(transport.calls).toHaveLength(1);
			expect(await outbox.findById(id)).toMatchObject({ status: "ambiguous", nextAttemptAt: null });
		});
	});

	it("treats edit not-modified and delete not-found as known success", async () => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			const editId = "66666666-6666-4666-8666-666666666666";
			const deleteId = "77777777-7777-4777-8777-777777777777";
			await outbox.create({ id: editId, idempotencyKey: "runtime.edit.known-success", kind: "channel_edit", recipientChatId: "-100123", messageId: 42, payload: { version: 1, method: "edit", text: "same" } });
			await outbox.create({ id: deleteId, idempotencyKey: "runtime.delete.known-success", kind: "channel_delete", recipientChatId: "-100123", messageId: 43, payload: { version: 1, method: "delete" } });
			transport.enqueueFailure(new TelegramTransportError({ code: "message_not_modified" }));
			transport.enqueueFailure(new TelegramTransportError({ code: "message_not_found" }));
			expect(await runner.runOnce()).toMatchObject({ outcome: "sent" });
			expect(await runner.runOnce()).toMatchObject({ outcome: "sent" });
			expect(await outbox.findById(editId)).toMatchObject({ status: "sent", messageId: 42 });
			expect(await outbox.findById(deleteId)).toMatchObject({ status: "sent", messageId: 43 });
			const retryDeleteId = "abababab-abab-4aba-8aba-abababababab";
			await outbox.create({ id: retryDeleteId, idempotencyKey: "runtime.delete.retry", kind: "channel_delete", recipientChatId: "-100123", messageId: 44, payload: { version: 1, method: "delete" } });
			transport.enqueueFailure(new TelegramTransportError({ code: "network", phase: "pre_send" }));
			expect(await runner.runOnce()).toMatchObject({ outcome: "retryable_failed" });
			expect(await outbox.findById(retryDeleteId)).toMatchObject({ status: "retryable_failed", messageId: 44 });
		});
	});

	it("retries known-target transient failures and makes the fifth known attempt permanent", async () => {
		await withRuntime(async ({ clock, outbox, runner, transport }) => {
			const id = "88888888-8888-4888-8888-888888888888";
			await outbox.create({ id, idempotencyKey: "runtime.edit.max-attempts", kind: "channel_edit", recipientChatId: "-100123", messageId: 42, payload: { version: 1, method: "edit", text: "retry" } });
			for (let attempt = 1; attempt <= 5; attempt += 1) {
				transport.enqueueFailure(new TelegramTransportError({ code: "network", phase: "pre_send" }));
				expect(await runner.runOnce()).toMatchObject({ outcome: attempt === 5 ? "permanent_failed" : "retryable_failed" });
				const current = await outbox.findById(id);
				if (attempt < 5) expect(current?.nextAttemptAt).toBe(clock.now().getTime() + ([1_000, 2_000, 4_000, 8_000][attempt - 1] ?? 0));
				if (current?.nextAttemptAt !== null && current?.nextAttemptAt !== undefined) clock.set(current.nextAttemptAt);
			}
			expect(await outbox.findById(id)).toMatchObject({ status: "permanent_failed", attemptCount: 5 });
		});
	});

	it("uses attempt-specific stale recovery delays and fences a late result across a restarted runner", async () => {
		await withRuntime(async ({ boundary, clock, outbox, runner, transport }) => {
			const id = "89898989-8989-4898-8898-898989898989";
			await outbox.create({ id, idempotencyKey: "runtime.edit.stale-attempt-three", kind: "channel_edit", recipientChatId: "-100123", messageId: 42, payload: { version: 1, method: "edit", text: "later retry" } });
			for (const expectedDelay of [1_000, 2_000]) {
				transport.enqueueFailure(new TelegramTransportError({ code: "network", phase: "pre_send" }));
				expect(await runner.runOnce()).toMatchObject({ outcome: "retryable_failed" });
				const current = await outbox.findById(id);
				expect(current?.nextAttemptAt).toBe(clock.now().getTime() + expectedDelay);
				clock.set(current?.nextAttemptAt ?? clock.now());
			}

			let resolveDeferred!: (response: TelegramTransportResponse) => void;
			transport.enqueueDeferred(new Promise<TelegramTransportResponse>((resolve) => { resolveDeferred = resolve; }));
			const pending = runner.runOnce();
			await new Promise<void>((resolve) => setImmediate(resolve));
			clock.advanceBy(60_000);
			expect(await runner.recoverStale()).toBe(1);
			const recovered = await outbox.findById(id);
			expect(recovered).toMatchObject({ status: "retryable_failed", attemptCount: 3, nextAttemptAt: clock.now().getTime() + 4_000 });

			const restartedRepository = new SqliteOutboxDeliveryRepository(boundary);
			const restartedRunner = new DeliveryRunner(restartedRepository, transport, new ImmediateDeadline(), new FixedClaimTokens(), clock);
			clock.set(recovered?.nextAttemptAt ?? clock.now());
			transport.enqueueSuccess(77);
			expect(await restartedRunner.runOnce()).toMatchObject({ outcome: "sent" });
			resolveDeferred({ method: "edit" });
			expect(await pending).toMatchObject({ outcome: "fenced" });
			expect(await outbox.findById(id)).toMatchObject({ status: "sent", attemptCount: 4, messageId: 42 });
		});
	});

	it("makes a stale fifth known-target attempt terminal", async () => {
		await withRuntime(async ({ clock, outbox, runner, transport }) => {
			const id = "8a8a8a8a-8a8a-48a8-88a8-8a8a8a8a8a8a";
			await outbox.create({ id, idempotencyKey: "runtime.edit.stale-attempt-five", kind: "channel_edit", recipientChatId: "-100123", messageId: 42, payload: { version: 1, method: "edit", text: "terminal retry" } });
			for (let attempt = 1; attempt <= 4; attempt += 1) {
				transport.enqueueFailure(new TelegramTransportError({ code: "network", phase: "pre_send" }));
				expect(await runner.runOnce()).toMatchObject({ outcome: "retryable_failed" });
				const current = await outbox.findById(id);
				clock.set(current?.nextAttemptAt ?? clock.now());
			}
			let resolveDeferred!: (response: TelegramTransportResponse) => void;
			transport.enqueueDeferred(new Promise<TelegramTransportResponse>((resolve) => { resolveDeferred = resolve; }));
			const pending = runner.runOnce();
			await new Promise<void>((resolve) => setImmediate(resolve));
			clock.advanceBy(60_000);
			expect(await runner.recoverStale()).toBe(1);
			expect(await outbox.findById(id)).toMatchObject({ status: "permanent_failed", attemptCount: 5, nextAttemptAt: null, lastErrorKind: "provider_timeout" });
			resolveDeferred({ method: "edit" });
			expect(await pending).toMatchObject({ outcome: "fenced" });
		});
	});

	it("claims due work deterministically with concurrency one and excludes cancelled/superseded intents", async () => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			const first = "99999999-9999-4999-8999-999999999999";
			const second = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
			const cancelled = "abababab-abab-4aba-8aba-abababababab";
			const superseded = "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc";
			await seedSend(outbox, first, "runtime.order.first");
			await seedSend(outbox, second, "runtime.order.second");
			await seedSend(outbox, cancelled, "runtime.order.cancelled");
			await seedSend(outbox, superseded, "runtime.order.superseded");
			await outbox.cancel(cancelled);
			await outbox.supersede(superseded);
			transport.enqueueSuccess(101);
			transport.enqueueSuccess(102);
			const results = await Promise.all([runner.runOnce(), runner.runOnce(), runner.runOnce()]);
			expect(results.map((result) => result.outcome)).toEqual(["sent", "sent", "idle"]);
			expect(transport.calls.map((call) => call.chatId)).toEqual(["123", "123"]);
			expect(await outbox.findById(cancelled)).toMatchObject({ status: "cancelled" });
			expect(await outbox.findById(superseded)).toMatchObject({ status: "superseded" });
		});
	});

	it("claim fencing recovers stale claims and rejects a late deferred provider result", async () => {
		await withRuntime(async ({ clock, outbox, runner, transport }) => {
			const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
			await outbox.create({ id, idempotencyKey: "runtime.edit.stale", kind: "channel_edit", recipientChatId: "-100123", messageId: 42, payload: { version: 1, method: "edit", text: "stale" } });
			let resolveDeferred!: (response: TelegramTransportResponse) => void;
			transport.enqueueDeferred(new Promise<TelegramTransportResponse>((resolve) => { resolveDeferred = resolve; }));
			const pending = runner.runOnce();
			await new Promise<void>((resolve) => setImmediate(resolve));
			clock.advanceBy(60_000);
			expect(await runner.recoverStale()).toBe(1);
			expect(await outbox.findById(id)).toMatchObject({ status: "retryable_failed", claimToken: null, nextAttemptAt: 61_000 + DAY_MS });
			resolveDeferred({ method: "edit" });
			expect(await pending).toMatchObject({ outcome: "fenced" });
			expect(await outbox.findById(id)).toMatchObject({ status: "retryable_failed" });
		});
	});

	it("recovers a stale send as ambiguous and never makes it due", async () => {
		await withRuntime(async ({ clock, outbox, runner, transport }) => {
			const id = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
			await seedSend(outbox, id, "runtime.send.stale");
			let resolveDeferred!: (response: TelegramTransportResponse) => void;
			transport.enqueueDeferred(new Promise<TelegramTransportResponse>((resolve) => { resolveDeferred = resolve; }));
			const pending = runner.runOnce();
			await new Promise<void>((resolve) => setImmediate(resolve));
			clock.advanceBy(60_000);
			expect(await runner.recoverStale()).toBe(1);
			expect(await outbox.findById(id)).toMatchObject({ status: "ambiguous", nextAttemptAt: null });
			resolveDeferred({ method: "send", messageId: 99 });
			expect(await pending).toMatchObject({ outcome: "fenced" });
		});
	});

	it("enforces the exact 15-second provider deadline without sleeping", async () => {
		const deadline = new SystemProviderDeadline();
		vi.useFakeTimers();
		try {
			const pending = deadline.run(undefined, async () => new Promise<never>(() => undefined));
			const rejected = expect(pending).rejects.toBeInstanceOf(ProviderDeadlineExceededError);
			await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
			await rejected;

			const shutdown = new AbortController();
			const shutdownPending = deadline.run(shutdown.signal, async (signal) => new Promise<never>((_resolve, reject) => {
				if (signal.aborted) {
					reject(signal.reason);
					return;
				}
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			}));
			const shutdownRejected = expect(shutdownPending).rejects.toBeInstanceOf(ProviderShutdownAbortError);
			shutdown.abort(new Error("shutdown"));
			await shutdownRejected;
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns an explicit shutdown outcome and leaves the claim durable for startup recovery", async () => {
		await withRuntime(async ({ outbox, runner, transport }) => {
			const id = "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0";
			await seedSend(outbox, id, "runtime.send.shutdown");
			let resolveDeferred!: (response: TelegramTransportResponse) => void;
			transport.enqueueDeferred(new Promise<TelegramTransportResponse>((resolve) => { resolveDeferred = resolve; }));
			const shutdown = new AbortController();
			const pending = runner.runOnce(shutdown.signal);
			await new Promise<void>((resolve) => setImmediate(resolve));
			shutdown.abort();

			expect(await pending).toMatchObject({ outcome: "shutdown", deliveryId: id });
			expect(await outbox.findById(id)).toMatchObject({ status: "dispatching", attemptCount: 1 });
			resolveDeferred({ method: "send", messageId: 999 });
		}, new SystemProviderDeadline());
	});

	it("uses the provider deadline classification for an ambiguous send", async () => {
		await withRuntime(async ({ outbox, runner }) => {
			const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
			await seedSend(outbox, id, "runtime.send.deadline.classified");
			expect(await runner.runOnce()).toMatchObject({ outcome: "ambiguous" });
		}, new FailingDeadline());
	});

	it("classifies edit and delete provider timeouts as retryable", async () => {
		await withRuntime(async ({ outbox, runner }) => {
			const id = "edededed-eded-4ede-8ede-edededededed";
			const deleteId = "efefefef-efef-4eff-8eff-efefefefefef";
			await outbox.create({ id, idempotencyKey: "runtime.edit.deadline.retryable", kind: "channel_edit", recipientChatId: "-100123", messageId: 42, payload: { version: 1, method: "edit", text: "timeout" } });
			await outbox.create({ id: deleteId, idempotencyKey: "runtime.delete.deadline.retryable", kind: "channel_delete", recipientChatId: "-100123", messageId: 43, payload: { version: 1, method: "delete" } });
			expect(await runner.runOnce()).toMatchObject({ outcome: "retryable_failed" });
			expect(await outbox.findById(id)).toMatchObject({ status: "retryable_failed", lastErrorKind: "provider_timeout" });
			expect(await runner.runOnce()).toMatchObject({ outcome: "retryable_failed" });
			expect(await outbox.findById(deleteId)).toMatchObject({ status: "retryable_failed", lastErrorKind: "provider_timeout" });
		}, new FailingDeadline());
	});

	it("fails closed on unsafe deadline and retry_after arithmetic", async () => {
		await withRuntime(async ({ outbox, repository, transport }) => {
			const id = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";
			await seedSend(outbox, id, "runtime.send.unsafe-deadline");
			const unsafeRunner = new DeliveryRunner(repository, transport, new ImmediateDeadline(), new FixedClaimTokens(), new StaticClock(Number.MAX_SAFE_INTEGER - 1_000));
			expect(await unsafeRunner.runOnce()).toMatchObject({ outcome: "unsafe" });
			expect(await outbox.findById(id)).toMatchObject({ status: "prepared" });
			expect(transport.calls).toHaveLength(0);
		}, new ImmediateDeadline());

		await withRuntime(async ({ outbox, repository, transport }) => {
			const id = "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2";
			await seedSend(outbox, id, "runtime.send.unsafe-retry-after");
			transport.enqueueFailure(new TelegramTransportError({ code: "rate_limited", retryAfterSeconds: Number.MAX_SAFE_INTEGER }));
			const unsafeRunner = new DeliveryRunner(repository, transport, new ImmediateDeadline(), new FixedClaimTokens(), new StaticClock(Number.MAX_SAFE_INTEGER - 20_000));
			expect(await unsafeRunner.runOnce()).toMatchObject({ outcome: "permanent_failed" });
			expect(await outbox.findById(id)).toMatchObject({ status: "permanent_failed", lastErrorKind: "unknown", nextAttemptAt: null });
		});
	});
});
