/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

describe("CF1-07 Durable Object alarms", () => {
	it("runs a scheduled bounded cycle and clears an empty queue", async () => {
		const stub = env.COLLABORATION_STATE.get(
			env.COLLABORATION_STATE.idFromName("cf1-07-empty-queue"),
		);
		expect((await stub.fetch("https://local/__cf1/ready")).status).toBe(200);

		const boundedCycle = vi.fn(async () => undefined);
		await runInDurableObject(stub, async (instance, state) => {
			(instance as unknown as { application: { runDeliveryCycleOnce: () => Promise<unknown> } }).application.runDeliveryCycleOnce = boundedCycle;
			await state.storage.setAlarm(Date.now() + 60_000);
			expect(await state.storage.getAlarm()).not.toBeNull();
		});

		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(boundedCycle).toHaveBeenCalledTimes(1);
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});

	it("prioritizes stale recovery before a later retry", async () => {
		const stub = env.COLLABORATION_STATE.get(
			env.COLLABORATION_STATE.idFromName("cf1-07-earliest-due"),
		);
		await stub.fetch("https://local/__cf1/ready");
		const createdAt = Date.now();
		const nextAttemptAt = createdAt + 10_000;
		await runInDurableObject(stub, async (_instance, state) => {
			state.storage.sql.exec(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, 'dm_send', '1', NULL, ?, 'dispatching', 1, ?, ?, ?, NULL, NULL, NULL, ?, ?)",
				...[
					"00000000-0000-4000-8000-000000000702",
					"cf1-07:scheduler:stale",
					JSON.stringify({ version: 1, method: "send", text: "stale delivery" }),
					"cf1-07:stale-claim",
					createdAt - 59_000,
					createdAt,
					createdAt - 59_000,
					createdAt - 59_000,
				],
			).toArray();
			state.storage.sql.exec(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, 'dm_send', '1', NULL, ?, 'retryable_failed', 1, NULL, NULL, NULL, ?, NULL, 'network', ?, ?)",
				...[
					"00000000-0000-4000-8000-000000000701",
					"cf1-07:scheduler:dm",
					JSON.stringify({ version: 1, method: "send", text: "scheduled delivery" }),
					nextAttemptAt,
					createdAt,
					createdAt,
				],
			).toArray();
		});

		await stub.fetch("https://local/__cf1/ready");
		await runInDurableObject(stub, async (_instance, state) => {
			const alarm = await state.storage.getAlarm();
			expect(alarm).not.toBeNull();
			expect(alarm).toBeGreaterThanOrEqual(createdAt + 900);
			expect(alarm).toBeLessThanOrEqual(createdAt + 2_000);
			state.storage.sql.exec("DELETE FROM outbox_deliveries WHERE id = ?", "00000000-0000-4000-8000-000000000702").toArray();
			await state.storage.deleteAlarm();
		});
		await stub.fetch("https://local/__cf1/ready");
		await runInDurableObject(stub, async (_instance, state) => {
			const alarm = await state.storage.getAlarm();
			expect(alarm).not.toBeNull();
			expect(alarm).toBeGreaterThanOrEqual(nextAttemptAt);
			expect(alarm).toBeLessThanOrEqual(nextAttemptAt + 1_000);
			state.storage.sql.exec("DELETE FROM outbox_deliveries WHERE id = ?", "00000000-0000-4000-8000-000000000701").toArray();
			await state.storage.deleteAlarm();
		});
	});

	it("performs one durable mutation and clears the alarm after the queue drains", async () => {
		const stub = env.COLLABORATION_STATE.get(
			env.COLLABORATION_STATE.idFromName("cf1-07-real-alarm-mutation"),
		);
		await stub.fetch("https://local/__cf1/ready");
		const mutation = vi.fn(async () => undefined);
		await runInDurableObject(stub, async (instance, state) => {
			(instance as unknown as { application: { runDeliveryCycleOnce: () => Promise<unknown> } }).application.runDeliveryCycleOnce = async () => {
				state.storage.sql.exec("UPDATE outbox_deliveries SET status = 'sent', message_id = 1, attempt_count = 1, updated_at = created_at WHERE id = '00000000-0000-4000-8000-000000000707'").toArray();
				mutation();
			};
			state.storage.sql.exec(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, 'dm_send', '1001', NULL, ?, 'prepared', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)",
				"00000000-0000-4000-8000-000000000707",
				"cf1-07:real-alarm-mutation",
				JSON.stringify({ version: 1, method: "send", text: "durable alarm delivery" }),
				Date.now() - 1_000,
				Date.now() - 1_000,
			).toArray();
			await state.storage.setAlarm(Date.now() + 60_000);
		});

		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(mutation).toHaveBeenCalledTimes(1);
		await runInDurableObject(stub, async (_instance, state) => {
			expect(state.storage.sql.exec("SELECT status, message_id, attempt_count FROM outbox_deliveries WHERE id = '00000000-0000-4000-8000-000000000707'").toArray()).toEqual([
				{ status: "sent", message_id: 1, attempt_count: 1 },
			]);
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});

	it("turns an alarm handler failure into a bounded retry alarm", async () => {
		const stub = env.COLLABORATION_STATE.get(
			env.COLLABORATION_STATE.idFromName("cf1-07-alarm-retry-after-throw"),
		);
		await stub.fetch("https://local/__cf1/ready");
		const failure = vi.fn(async () => { throw new Error("synthetic alarm failure"); });
		await runInDurableObject(stub, async (instance, state) => {
			(instance as unknown as { application: { runDeliveryCycleOnce: () => Promise<void> } }).application.runDeliveryCycleOnce = failure;
			await state.storage.setAlarm(Date.now() + 60_000);
		});
		const before = Date.now();
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(failure).toHaveBeenCalledTimes(1);
		await runInDurableObject(stub, async (_instance, state) => {
			const alarm = await state.storage.getAlarm();
			expect(alarm).not.toBeNull();
			expect(alarm as number).toBeGreaterThanOrEqual(before);
			expect(alarm as number).toBeLessThanOrEqual(before + 2_000);
			await state.storage.deleteAlarm();
		});
	});

	it("does not reschedule an ambiguous delivery as an automatic retry", async () => {
		const stub = env.COLLABORATION_STATE.get(
			env.COLLABORATION_STATE.idFromName("cf1-07-ambiguous-terminal"),
		);
		await stub.fetch("https://local/__cf1/ready");
		await runInDurableObject(stub, async (instance, state) => {
			(instance as unknown as { application: { runDeliveryCycleOnce: () => Promise<void> } }).application.runDeliveryCycleOnce = async () => {
				state.storage.sql.exec("UPDATE outbox_deliveries SET status = 'ambiguous', claim_token = NULL, dispatch_started_at = NULL, request_deadline_at = NULL, last_error_kind = 'network', updated_at = created_at WHERE id = '00000000-0000-4000-8000-000000000708'").toArray();
			};
			state.storage.sql.exec(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, 'dm_send', '1002', NULL, ?, 'dispatching', 1, 'cf1-07:ambiguous-claim', ?, ?, NULL, NULL, NULL, ?, ?)",
				"00000000-0000-4000-8000-000000000708",
				"cf1-07:ambiguous",
				JSON.stringify({ version: 1, method: "send", text: "ambiguous delivery" }),
				Date.now() - 1_000,
				Date.now() + 10_000,
				Date.now() - 1_000,
				Date.now() - 1_000,
			).toArray();
			await state.storage.setAlarm(Date.now() + 60_000);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (_instance, state) => {
			expect(state.storage.sql.exec("SELECT status, last_error_kind, next_attempt_at FROM outbox_deliveries WHERE id = '00000000-0000-4000-8000-000000000708'").toArray()).toEqual([
				{ status: "ambiguous", last_error_kind: "network", next_attempt_at: null },
			]);
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});
});
