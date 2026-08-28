import {
	PRODUCT_EVENT_TYPES,
	parseSafeAttributes,
	type ProductEventRecord,
} from "../../shared/application/outbox/product-event-service.js";
import type { ProductEventStore } from "../../shared/application/ports/product-event-store.js";
import {
	ProductEventStoreConflictError,
	ProductEventStoreCorruptError,
	ProductEventStoreIdConflictError,
} from "../../shared/application/ports/product-event-store.js";
import { serializeSafeAttributes } from "../../shared/application/outbox/product-event-service.js";
import { resolveSqlDatabase, type SqlDatabaseInput } from "../database/node-sql-database.js";
import type { SqlDatabase } from "../../shared/application/ports/sql-database.js";

interface ProductEventRow {
	event_id?: unknown;
	event_type?: unknown;
	idempotency_key?: unknown;
	actor_telegram_user_id?: unknown;
	profile_id?: unknown;
	collaboration_id?: unknown;
	application_id?: unknown;
	safe_attributes_json?: unknown;
	occurred_at?: unknown;
}

export class SqliteProductEventRepository implements ProductEventStore {
	private readonly boundary: SqlDatabase;

	constructor(source: SqlDatabaseInput) {
		this.boundary = resolveSqlDatabase(source);
	}

	async findByIdempotencyKey(idempotencyKey: string): Promise<ProductEventRecord | undefined> {
		const rows = await this.boundary.query<ProductEventRow>(
			"SELECT event_id, event_type, idempotency_key, actor_telegram_user_id, profile_id, collaboration_id, application_id, safe_attributes_json, occurred_at FROM product_events WHERE idempotency_key = ?",
			[idempotencyKey],
		);
		const row = rows[0];
		return row === undefined ? undefined : mapRow(row);
	}

	async append(record: ProductEventRecord): Promise<void> {
		try {
			await this.boundary.execute(
				"INSERT INTO product_events (event_id, event_type, idempotency_key, actor_telegram_user_id, profile_id, collaboration_id, application_id, safe_attributes_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				[
					record.eventId,
					record.eventType,
					record.idempotencyKey,
					record.actorTelegramUserId,
					record.profileId,
					record.collaborationId,
					record.applicationId,
					serializeSafeAttributes(record.safeAttributes, record.eventType),
					record.occurredAt,
				],
			);
		} catch (error) {
			if (String(error).includes("UNIQUE constraint failed: product_events.event_id")) {
				throw new ProductEventStoreIdConflictError();
			}
			if (String(error).includes("UNIQUE constraint failed")) {
				throw new ProductEventStoreConflictError();
			}
			throw error;
		}
	}
}

function mapRow(row: ProductEventRow): ProductEventRecord {
	if (
		typeof row.event_id !== "string" || !UUID.test(row.event_id) ||
		typeof row.event_type !== "string" || !PRODUCT_EVENT_TYPES.includes(row.event_type as ProductEventRecord["eventType"]) ||
		typeof row.idempotency_key !== "string" || !INTERNAL_ID.test(row.idempotency_key) ||
		(row.actor_telegram_user_id !== null && (typeof row.actor_telegram_user_id !== "string" || !/^[0-9]{1,20}$/.test(row.actor_telegram_user_id))) ||
		(row.profile_id !== null && (typeof row.profile_id !== "string" || !INTERNAL_ID.test(row.profile_id))) ||
		(row.collaboration_id !== null && (typeof row.collaboration_id !== "string" || !INTERNAL_ID.test(row.collaboration_id))) ||
		(row.application_id !== null && (typeof row.application_id !== "string" || !INTERNAL_ID.test(row.application_id))) ||
		typeof row.safe_attributes_json !== "string" ||
		!Number.isSafeInteger(row.occurred_at) || (row.occurred_at as number) < 0
	) {
		throw new ProductEventStoreCorruptError();
	}
	let safeAttributes;
	try {
		safeAttributes = parseSafeAttributes(row.safe_attributes_json, row.event_type as ProductEventRecord["eventType"]);
	} catch {
		throw new ProductEventStoreCorruptError();
	}
	return {
		eventId: row.event_id,
		eventType: row.event_type as ProductEventRecord["eventType"],
		idempotencyKey: row.idempotency_key,
		actorTelegramUserId: row.actor_telegram_user_id as string | null,
		profileId: row.profile_id as string | null,
		collaborationId: row.collaboration_id as string | null,
		applicationId: row.application_id as string | null,
		safeAttributes,
		occurredAt: row.occurred_at as number,
	};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
