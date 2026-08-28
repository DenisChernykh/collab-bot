import type {
	DeliveryErrorKind,
	OutboxDeliveryKind,
	OutboxDeliveryRecord,
	OutboxDeliveryStore,
} from "../../shared/application/ports/outbox-delivery-store.js";
import {
	DELIVERY_ERROR_KINDS,
	OUTBOX_DELIVERY_KINDS,
	OUTBOX_DELIVERY_STATUSES,
	OutboxStoreConflictError,
	OutboxStoreCorruptError,
} from "../../shared/application/ports/outbox-delivery-store.js";
import {
	parseDeliveryPayload,
	serializeDeliveryPayload,
} from "../../shared/application/outbox/delivery-payload.js";
import type { DatabaseBoundary } from "../../platform/database/database-boundary.js";

interface OutboxRow {
	id?: unknown;
	idempotency_key?: unknown;
	kind?: unknown;
	recipient_chat_id?: unknown;
	message_id?: unknown;
	payload_json?: unknown;
	status?: unknown;
	attempt_count?: unknown;
	claim_token?: unknown;
	dispatch_started_at?: unknown;
	request_deadline_at?: unknown;
	next_attempt_at?: unknown;
	telegram_retry_after?: unknown;
	last_error_kind?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
}

export class SqliteOutboxDeliveryRepository implements OutboxDeliveryStore {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findById(id: string): Promise<OutboxDeliveryRecord | undefined> {
		return this.find("id", id);
	}

	async findByIdempotencyKey(idempotencyKey: string): Promise<OutboxDeliveryRecord | undefined> {
		return this.find("idempotency_key", idempotencyKey);
	}

	async insert(record: OutboxDeliveryRecord): Promise<void> {
		try {
			await this.boundary.execute(
				"INSERT INTO outbox_deliveries (id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				[
					record.id,
					record.idempotencyKey,
					record.kind,
					record.recipientChatId,
					record.messageId,
					serializeDeliveryPayload(record.payload),
					record.status,
					record.attemptCount,
					record.claimToken,
					record.dispatchStartedAt,
					record.requestDeadlineAt,
					record.nextAttemptAt,
					record.telegramRetryAfter,
					record.lastErrorKind,
					record.createdAt,
					record.updatedAt,
				],
			);
		} catch (error) {
			if (String(error).includes("UNIQUE constraint failed")) {
				throw new OutboxStoreConflictError();
			}
			throw error;
		}
	}

	async cancel(id: string, updatedAt: number): Promise<void> {
		await this.requireChanged(
			"UPDATE outbox_deliveries SET status = 'cancelled', next_attempt_at = NULL, updated_at = ? WHERE id = ? AND status = 'prepared' AND attempt_count = 0 AND claim_token IS NULL AND dispatch_started_at IS NULL AND request_deadline_at IS NULL AND telegram_retry_after IS NULL AND last_error_kind IS NULL AND (kind IN ('channel_edit', 'channel_delete') OR message_id IS NULL)",
			[updatedAt, id],
		);
	}

	async cancelUnclaimed(id: string, updatedAt: number): Promise<boolean> {
		const prepared = await this.boundary.execute(
			"UPDATE outbox_deliveries SET status = 'cancelled', next_attempt_at = NULL, telegram_retry_after = NULL, last_error_kind = NULL, updated_at = ? WHERE id = ? AND status = 'prepared' AND claim_token IS NULL AND dispatch_started_at IS NULL AND request_deadline_at IS NULL AND message_id IS NULL",
			[updatedAt, id],
		) as { changes?: number };
		if (prepared.changes === 1) return true;
		const retryable = await this.boundary.execute(
			"UPDATE outbox_deliveries SET status = 'permanent_failed', next_attempt_at = NULL, telegram_retry_after = NULL, last_error_kind = 'provider_timeout', updated_at = ? WHERE id = ? AND status = 'retryable_failed' AND claim_token IS NULL AND dispatch_started_at IS NULL AND request_deadline_at IS NULL AND message_id IS NULL",
			[updatedAt, id],
		) as { changes?: number };
		return retryable.changes === 1;
	}

	async supersede(id: string, updatedAt: number): Promise<void> {
		await this.requireChanged(
			"UPDATE outbox_deliveries SET status = 'superseded', claim_token = NULL, dispatch_started_at = NULL, request_deadline_at = NULL, next_attempt_at = NULL, telegram_retry_after = NULL, last_error_kind = NULL, updated_at = ? WHERE id = ? AND status = 'prepared' AND attempt_count = 0 AND claim_token IS NULL AND dispatch_started_at IS NULL AND request_deadline_at IS NULL AND telegram_retry_after IS NULL AND last_error_kind IS NULL",
			[updatedAt, id],
		);
	}

	async claimDue(now: number, claimToken: string, requestDeadlineAt: number, allowedKinds?: readonly OutboxDeliveryKind[]): Promise<OutboxDeliveryRecord | undefined> {
		if (allowedKinds !== undefined && allowedKinds.length === 0) return undefined;
		const kindClause = allowedKinds === undefined ? "" : ` AND kind IN (${allowedKinds.map(() => "?").join(", ")})`;
		const kindParameters = allowedKinds ?? [];
		return this.boundary.withTransaction(async () => {
			const candidates = await this.boundary.query<{ id: string }>(
				`SELECT id FROM outbox_deliveries WHERE ((status = 'prepared' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'retryable_failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?))${kindClause} ORDER BY COALESCE(next_attempt_at, created_at), created_at, id LIMIT 1`,
				[now, now, ...kindParameters],
			);
			const candidate = candidates[0];
			if (candidate === undefined) return undefined;
			const result = await this.boundary.execute(
				`UPDATE outbox_deliveries SET status = 'dispatching', attempt_count = attempt_count + 1, claim_token = ?, dispatch_started_at = ?, request_deadline_at = ?, next_attempt_at = NULL, telegram_retry_after = NULL, last_error_kind = NULL, updated_at = ? WHERE id = ? AND ((status = 'prepared' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'retryable_failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?))${kindClause}`,
				[claimToken, now, requestDeadlineAt, now, candidate.id, now, now, ...kindParameters],
			) as { changes?: number };
			if (result.changes !== 1) return undefined;
			return this.readById(candidate.id);
		});
	}

	async markSent(id: string, claimToken: string, updatedAt: number, messageId: number): Promise<boolean> {
		return this.conditional(
			"UPDATE outbox_deliveries SET status = 'sent', message_id = ?, claim_token = NULL, dispatch_started_at = NULL, request_deadline_at = NULL, next_attempt_at = NULL, telegram_retry_after = NULL, last_error_kind = NULL, updated_at = ? WHERE id = ? AND status = 'dispatching' AND claim_token = ?",
			[messageId, updatedAt, id, claimToken],
		);
	}

	async markRetryable(
		id: string,
		claimToken: string,
		updatedAt: number,
		nextAttemptAt: number,
		lastErrorKind: DeliveryErrorKind,
		telegramRetryAfter: number | null,
	): Promise<boolean> {
		return this.conditional(
			"UPDATE outbox_deliveries SET status = 'retryable_failed', claim_token = NULL, dispatch_started_at = NULL, request_deadline_at = NULL, next_attempt_at = ?, telegram_retry_after = ?, last_error_kind = ?, updated_at = ? WHERE id = ? AND status = 'dispatching' AND claim_token = ?",
			[nextAttemptAt, telegramRetryAfter, lastErrorKind, updatedAt, id, claimToken],
		);
	}

	async markAmbiguous(id: string, claimToken: string, updatedAt: number, lastErrorKind: DeliveryErrorKind): Promise<boolean> {
		return this.conditional(
			"UPDATE outbox_deliveries SET status = 'ambiguous', claim_token = NULL, dispatch_started_at = NULL, request_deadline_at = NULL, next_attempt_at = NULL, telegram_retry_after = NULL, last_error_kind = ?, updated_at = ? WHERE id = ? AND status = 'dispatching' AND claim_token = ?",
			[lastErrorKind, updatedAt, id, claimToken],
		);
	}

	async markPermanent(id: string, claimToken: string, updatedAt: number, lastErrorKind: DeliveryErrorKind): Promise<boolean> {
		return this.conditional(
			"UPDATE outbox_deliveries SET status = 'permanent_failed', claim_token = NULL, dispatch_started_at = NULL, request_deadline_at = NULL, next_attempt_at = NULL, telegram_retry_after = NULL, last_error_kind = ?, updated_at = ? WHERE id = ? AND status = 'dispatching' AND claim_token = ?",
			[lastErrorKind, updatedAt, id, claimToken],
		);
	}

	async recoverStale(now: number, staleBefore: number, retryAtByAttempt: readonly (number | null)[]): Promise<number> {
		if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(staleBefore) || retryAtByAttempt.length !== 4 || retryAtByAttempt.some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))) {
			throw new OutboxStoreCorruptError();
		}
		return this.boundary.withTransaction(async () => {
			const staleRows = await this.boundary.query<{ id: unknown; kind: unknown; attempt_count: unknown }>(
				"SELECT id, kind, attempt_count FROM outbox_deliveries WHERE status = 'dispatching' AND dispatch_started_at IS NOT NULL AND dispatch_started_at <= ? ORDER BY dispatch_started_at, id",
				[staleBefore],
			);
			let changed = 0;
			for (const row of staleRows) {
				if (typeof row.id !== "string" || typeof row.kind !== "string" || !Number.isSafeInteger(row.attempt_count) || (row.attempt_count as number) < 1) {
					throw new OutboxStoreCorruptError();
				}
				const knownTarget = row.kind === "channel_edit" || row.kind === "channel_delete";
				const retryAt = knownTarget && (row.attempt_count as number) <= 4 ? retryAtByAttempt[(row.attempt_count as number) - 1] ?? null : null;
				const status = knownTarget ? retryAt === null ? "permanent_failed" : "retryable_failed" : "ambiguous";
				const result = await this.boundary.execute(
					"UPDATE outbox_deliveries SET status = ?, claim_token = NULL, dispatch_started_at = NULL, request_deadline_at = NULL, next_attempt_at = ?, telegram_retry_after = NULL, last_error_kind = 'provider_timeout', updated_at = ? WHERE id = ? AND status = 'dispatching' AND dispatch_started_at IS NOT NULL AND dispatch_started_at <= ?",
					[status, retryAt, now, row.id, staleBefore],
				) as { changes?: number };
				if (result.changes === 1) changed += 1;
			}
			return changed;
		});
	}

	private async find(column: "id" | "idempotency_key", value: string): Promise<OutboxDeliveryRecord | undefined> {
		const rows = await this.boundary.query<OutboxRow>(
			`SELECT id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at FROM outbox_deliveries WHERE ${column} = ?`,
			[value],
		);
		const row = rows[0];
		return row === undefined ? undefined : mapRow(row);
	}

	private async readById(id: string): Promise<OutboxDeliveryRecord | undefined> {
		const rows = await this.boundary.query<OutboxRow>(
			"SELECT id, idempotency_key, kind, recipient_chat_id, message_id, payload_json, status, attempt_count, claim_token, dispatch_started_at, request_deadline_at, next_attempt_at, telegram_retry_after, last_error_kind, created_at, updated_at FROM outbox_deliveries WHERE id = ?",
			[id],
		);
		const row = rows[0];
		return row === undefined ? undefined : mapRow(row);
	}

	private async conditional(sql: string, parameters: readonly (string | number | null)[]): Promise<boolean> {
		const result = await this.boundary.execute(sql, parameters) as { changes?: number };
		return result.changes === 1;
	}

	private async requireChanged(sql: string, parameters: readonly (string | number | null)[]): Promise<void> {
		const result = await this.boundary.execute(sql, parameters) as { changes?: number };
		if (result.changes !== 1) {
			throw new OutboxStoreConflictError();
		}
	}
}

function mapRow(row: OutboxRow): OutboxDeliveryRecord {
	if (
		typeof row.id !== "string" || !UUID.test(row.id) ||
		typeof row.idempotency_key !== "string" || !INTERNAL_ID.test(row.idempotency_key) ||
		typeof row.kind !== "string" || !OUTBOX_DELIVERY_KINDS.includes(row.kind as OutboxDeliveryRecord["kind"]) ||
		typeof row.recipient_chat_id !== "string" || !/^-?[0-9]{1,20}$/.test(row.recipient_chat_id) ||
		(row.message_id !== null && (!Number.isSafeInteger(row.message_id) || (row.message_id as number) <= 0)) ||
		typeof row.payload_json !== "string" ||
		typeof row.status !== "string" || !OUTBOX_DELIVERY_STATUSES.includes(row.status as OutboxDeliveryRecord["status"]) ||
		!Number.isSafeInteger(row.attempt_count) || (row.attempt_count as number) < 0 ||
		(row.claim_token !== null && (typeof row.claim_token !== "string" || !INTERNAL_ID.test(row.claim_token))) ||
		(row.dispatch_started_at !== null && (!Number.isSafeInteger(row.dispatch_started_at) || (row.dispatch_started_at as number) < 0)) ||
		(row.request_deadline_at !== null && (!Number.isSafeInteger(row.request_deadline_at) || (row.request_deadline_at as number) < 0)) ||
		(row.next_attempt_at !== null && (!Number.isSafeInteger(row.next_attempt_at) || (row.next_attempt_at as number) < 0)) ||
		(row.telegram_retry_after !== null && (!Number.isSafeInteger(row.telegram_retry_after) || (row.telegram_retry_after as number) < 0)) ||
		(row.last_error_kind !== null && (typeof row.last_error_kind !== "string" || !DELIVERY_ERROR_KINDS.includes(row.last_error_kind as DeliveryErrorKind))) ||
		!Number.isSafeInteger(row.created_at) || (row.created_at as number) < 0 ||
		!Number.isSafeInteger(row.updated_at) || (row.updated_at as number) < (row.created_at as number)
	) {
		throw new OutboxStoreCorruptError();
	}
	let payload;
	try {
		payload = parseDeliveryPayload(row.payload_json);
	} catch {
		throw new OutboxStoreCorruptError();
	}
	if (
		(row.kind === "dm_send" || row.kind === "channel_send") && payload.method !== "send" ||
		row.kind === "channel_edit" && (payload.method !== "edit" || row.message_id === null) ||
		row.kind === "channel_delete" && (payload.method !== "delete" || row.message_id === null) ||
		row.status === "sent" && row.message_id === null ||
		row.status === "dispatching" && (row.attempt_count === 0 || row.claim_token === null || row.dispatch_started_at === null || row.request_deadline_at === null) ||
		row.status !== "dispatching" && (row.claim_token !== null || row.dispatch_started_at !== null || row.request_deadline_at !== null) ||
		(row.status === "sent" || row.status === "permanent_failed") && row.attempt_count === 0 ||
		row.status === "sent" && (row.next_attempt_at !== null || row.telegram_retry_after !== null || row.last_error_kind !== null) ||
		row.status === "permanent_failed" && (row.last_error_kind === null || row.next_attempt_at !== null || row.telegram_retry_after !== null) ||
		row.next_attempt_at !== null && !["prepared", "retryable_failed"].includes(row.status) ||
		row.telegram_retry_after !== null && row.status !== "retryable_failed" ||
		row.last_error_kind !== null && !["retryable_failed", "ambiguous", "permanent_failed"].includes(row.status) ||
		row.status === "retryable_failed" && (row.attempt_count === 0 || row.next_attempt_at === null || row.last_error_kind === null) ||
		row.status === "ambiguous" && (row.attempt_count === 0 || row.next_attempt_at !== null || row.last_error_kind === null) ||
		row.status === "prepared" && (row.attempt_count !== 0 || row.next_attempt_at !== null && (row.next_attempt_at as number) < (row.created_at as number) || row.telegram_retry_after !== null || row.last_error_kind !== null) ||
		row.status === "cancelled" && ((row.kind === "dm_send" || row.kind === "channel_send") && row.message_id !== null || row.claim_token !== null || row.dispatch_started_at !== null || row.request_deadline_at !== null || row.next_attempt_at !== null || row.telegram_retry_after !== null || row.last_error_kind !== null)
	) {
		throw new OutboxStoreCorruptError();
	}
	return {
		id: row.id,
		idempotencyKey: row.idempotency_key,
		kind: row.kind as OutboxDeliveryRecord["kind"],
		recipientChatId: row.recipient_chat_id,
		messageId: row.message_id as number | null,
		payload,
		status: row.status as OutboxDeliveryRecord["status"],
		attemptCount: row.attempt_count as number,
		claimToken: row.claim_token as string | null,
		dispatchStartedAt: row.dispatch_started_at as number | null,
		requestDeadlineAt: row.request_deadline_at as number | null,
		nextAttemptAt: row.next_attempt_at as number | null,
		telegramRetryAfter: row.telegram_retry_after as number | null,
		lastErrorKind: row.last_error_kind as DeliveryErrorKind | null,
		createdAt: row.created_at as number,
		updatedAt: row.updated_at as number,
	};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
