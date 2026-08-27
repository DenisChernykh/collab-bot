import type {
	CollaborationPublicationRecord,
	CollaborationPublicationRepository,
	CollaborationPublicationStatus,
	CollaborationSummary,
} from "../../application/ports/collaboration-publication-repository.js";
import type { DeliveryErrorKind } from "../../application/ports/outbox-delivery-store.js";
import { DELIVERY_ERROR_KINDS } from "../../application/ports/outbox-delivery-store.js";
import type { DatabaseBoundary } from "./database-boundary.js";

interface PublicationRow {
	collaboration_id?: unknown; channel_chat_id?: unknown; message_id?: unknown; status?: unknown;
	rendered_terms_version?: unknown; rendered_projection_revision?: unknown; rendered_hash?: unknown;
	current_attempt_no?: unknown; last_delivery_id?: unknown; last_error_kind?: unknown; updated_at?: unknown;
}

export class SqliteCollaborationPublicationRepository implements CollaborationPublicationRepository {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findByCollaborationId(collaborationId: string): Promise<CollaborationPublicationRecord | undefined> {
		const rows = await this.boundary.query<PublicationRow>(this.selectSql("collaboration_id = ?"), [collaborationId]);
		return rows[0] === undefined ? undefined : mapRow(rows[0]);
	}

	async findByDeliveryId(deliveryId: string): Promise<CollaborationPublicationRecord | undefined> {
		const rows = await this.boundary.query<PublicationRow>(this.selectSql("last_delivery_id = ? AND status IN ('prepared', 'sending')"), [deliveryId]);
		return rows[0] === undefined ? undefined : mapRow(rows[0]);
	}

	async insert(record: CollaborationPublicationRecord): Promise<void> {
		await this.boundary.execute(
			"INSERT INTO channel_publications (collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[record.collaborationId, record.channelChatId, record.messageId, record.status, record.renderedTermsVersion, record.renderedProjectionRevision, record.renderedHash, record.currentAttemptNo, record.lastDeliveryId, record.lastErrorKind, record.updatedAt],
		);
	}

	async markPublishing(collaborationId: string, publicToken: string, updatedAt: number): Promise<void> {
		const result = await this.boundary.execute("UPDATE collaborations SET public_token = ?, status = 'publishing', version = version + 1, projection_revision = projection_revision + 1, updated_at = ? WHERE id = ? AND status = 'draft' AND public_token IS NULL", [publicToken, updatedAt, collaborationId]) as { changes?: number };
		if (result.changes !== 1) throw new Error("collaboration is no longer publishable");
	}

	async updatePrepared(record: CollaborationPublicationRecord): Promise<void> {
		await this.boundary.execute(
			"UPDATE channel_publications SET message_id = ?, status = ?, rendered_terms_version = ?, rendered_projection_revision = ?, rendered_hash = ?, current_attempt_no = ?, last_delivery_id = ?, last_error_kind = ?, updated_at = ? WHERE collaboration_id = ?",
			[record.messageId, record.status, record.renderedTermsVersion, record.renderedProjectionRevision, record.renderedHash, record.currentAttemptNo, record.lastDeliveryId, record.lastErrorKind, record.updatedAt, record.collaborationId],
		);
	}

	async markOutcome(collaborationId: string, status: CollaborationPublicationStatus, messageId: number | null, errorKind: DeliveryErrorKind | null, updatedAt: number): Promise<boolean> {
		return this.boundary.withTransaction(async () => {
			const publicationUpdate = await this.boundary.execute("UPDATE channel_publications SET status = ?, message_id = ?, last_error_kind = ?, updated_at = ? WHERE collaboration_id = ? AND status IN ('prepared', 'sending')", [status, messageId, errorKind, updatedAt, collaborationId]) as { changes?: number };
			if (publicationUpdate.changes !== 1) return false;
			const collaborationStatus = status === "published" ? "published" : "publication_failed";
			const collaborationUpdate = status === "published"
				? await this.boundary.execute("UPDATE collaborations SET status = ?, published_at = COALESCE(published_at, ?), projection_revision = projection_revision + 1, version = version + 1, updated_at = ? WHERE id = ? AND status = 'publishing'", [collaborationStatus, updatedAt, updatedAt, collaborationId]) as { changes?: number }
				: await this.boundary.execute("UPDATE collaborations SET status = ?, projection_revision = projection_revision + 1, version = version + 1, updated_at = ? WHERE id = ? AND status = 'publishing'", [collaborationStatus, updatedAt, collaborationId]) as { changes?: number };
			if (collaborationUpdate.changes !== 1) throw new Error("collaboration publication state is inconsistent");
			return true;
		});
	}

	async markExpired(collaborationId: string, messageId: number, updatedAt: number): Promise<boolean> {
		return this.boundary.withTransaction(async () => {
			const publicationUpdate = await this.boundary.execute("UPDATE channel_publications SET status = 'published', message_id = ?, updated_at = ? WHERE collaboration_id = ? AND status IN ('prepared', 'sending')", [messageId, updatedAt, collaborationId]) as { changes?: number };
			if (publicationUpdate.changes !== 1) return false;
			const collaborationUpdate = await this.boundary.execute("UPDATE collaborations SET status = 'expired', published_at = COALESCE(published_at, ?), projection_revision = projection_revision + 1, version = version + 1, updated_at = ? WHERE id = ? AND status = 'publishing'", [updatedAt, updatedAt, collaborationId]) as { changes?: number };
			if (collaborationUpdate.changes !== 1) throw new Error("collaboration publication state is inconsistent");
			return true;
		});
	}

	async markDeadlineExpired(collaborationId: string, updatedAt: number): Promise<boolean> {
		return this.boundary.withTransaction(async () => {
			const publicationUpdate = await this.boundary.execute("UPDATE channel_publications SET status = 'failed', last_error_kind = 'provider_timeout', updated_at = ? WHERE collaboration_id = ? AND status IN ('prepared', 'sending')", [updatedAt, collaborationId]) as { changes?: number };
			if (publicationUpdate.changes !== 1) return false;
			await this.boundary.execute("UPDATE collaborations SET status = 'expired', projection_revision = projection_revision + 1, version = version + 1, updated_at = ? WHERE id = ? AND status = 'publishing'", [updatedAt, collaborationId]);
			return true;
		});
	}

	async listOwn(telegramUserId: string): Promise<readonly CollaborationSummary[]> {
		const rows = await this.boundary.query<Record<string, unknown>>(
			"SELECT c.id AS collaboration_id, c.title, c.status, c.format, c.response_deadline_at, c.event_date_local, c.created_at, c.updated_at FROM collaborations c JOIN profiles p ON p.id = c.author_profile_id WHERE p.telegram_user_id = ? AND c.status IN ('draft', 'publishing', 'published', 'publication_failed', 'expired') ORDER BY c.created_at DESC, c.id DESC",
			[telegramUserId],
		);
		return rows.map((row) => {
			if (typeof row.collaboration_id !== "string" || (row.title !== null && typeof row.title !== "string") || typeof row.status !== "string" || (row.format !== null && typeof row.format !== "string") || (row.response_deadline_at !== null && !Number.isSafeInteger(row.response_deadline_at as number)) || (row.event_date_local !== null && typeof row.event_date_local !== "string") || !Number.isSafeInteger(row.created_at as number) || !Number.isSafeInteger(row.updated_at as number)) throw new Error("collaboration summary row is corrupt");
			return { collaborationId: row.collaboration_id, title: row.title as string | null, status: row.status as CollaborationSummary["status"], format: row.format as CollaborationSummary["format"], responseDeadlineAt: row.response_deadline_at as number | null, eventDateLocal: row.event_date_local as string | null, createdAt: row.created_at as number, updatedAt: row.updated_at as number };
		});
	}

	async listPendingExpired(now: number): Promise<readonly { collaborationId: string; deliveryId: string }[]> {
		const rows = await this.boundary.query<{ collaboration_id?: unknown; delivery_id?: unknown }>(
			"SELECT p.collaboration_id, p.last_delivery_id AS delivery_id FROM channel_publications p JOIN collaborations c ON c.id = p.collaboration_id JOIN outbox_deliveries d ON d.id = p.last_delivery_id WHERE c.status = 'publishing' AND p.status IN ('prepared', 'sending') AND c.response_deadline_at < ? AND d.status IN ('prepared', 'retryable_failed')",
			[now],
		);
		return rows.flatMap((row) => typeof row.collaboration_id === "string" && typeof row.delivery_id === "string" ? [{ collaborationId: row.collaboration_id, deliveryId: row.delivery_id }] : []);
	}

	async listTerminalDeliveryIds(): Promise<readonly string[]> {
		const rows = await this.boundary.query<{ delivery_id?: unknown }>("SELECT p.last_delivery_id AS delivery_id FROM channel_publications p JOIN outbox_deliveries d ON d.id = p.last_delivery_id WHERE p.status IN ('prepared', 'sending') AND d.status IN ('sent', 'ambiguous', 'permanent_failed', 'cancelled') ORDER BY d.updated_at, d.id");
		return rows.flatMap((row) => typeof row.delivery_id === "string" ? [row.delivery_id] : []);
	}

	private selectSql(predicate: string): string {
		return `SELECT collaboration_id, channel_chat_id, message_id, status, rendered_terms_version, rendered_projection_revision, rendered_hash, current_attempt_no, last_delivery_id, last_error_kind, updated_at FROM channel_publications WHERE ${predicate}`;
	}
}

function mapRow(row: PublicationRow): CollaborationPublicationRecord {
	if (typeof row.collaboration_id !== "string" || typeof row.channel_chat_id !== "string" || (row.message_id !== null && (!Number.isSafeInteger(row.message_id) || (row.message_id as number) <= 0)) || typeof row.status !== "string" || !["prepared", "sending", "published", "failed"].includes(row.status) || !Number.isSafeInteger(row.rendered_terms_version) || !Number.isSafeInteger(row.rendered_projection_revision) || typeof row.rendered_hash !== "string" || !/^[0-9a-f]{64}$/.test(row.rendered_hash) || !Number.isSafeInteger(row.current_attempt_no) || (row.last_delivery_id !== null && typeof row.last_delivery_id !== "string") || (row.last_error_kind !== null && (typeof row.last_error_kind !== "string" || !DELIVERY_ERROR_KINDS.includes(row.last_error_kind as DeliveryErrorKind))) || !Number.isSafeInteger(row.updated_at)) throw new Error("channel publication row is corrupt");
	return { collaborationId: row.collaboration_id, channelChatId: row.channel_chat_id, messageId: row.message_id as number | null, status: row.status as CollaborationPublicationStatus, renderedTermsVersion: row.rendered_terms_version as number, renderedProjectionRevision: row.rendered_projection_revision as number, renderedHash: row.rendered_hash, currentAttemptNo: row.current_attempt_no as number, lastDeliveryId: row.last_delivery_id as string | null, lastErrorKind: row.last_error_kind as DeliveryErrorKind | null, updatedAt: row.updated_at as number };
}
