import {
	type AdminModerationRepository,
	type AdminModerationStatus,
	type AdminModerationTarget,
	type OperatorActionRecord,
} from "../application/ports/admin-moderation-repository.js";
import type { DatabaseBoundary } from "../../../infrastructure/database/database-boundary.js";

const STATUSES = new Set<AdminModerationStatus>([
	"draft",
	"publishing",
	"published",
	"publication_failed",
	"matched",
	"completed",
	"cancelled",
	"expired",
	"hidden",
]);

interface AdminTargetRow {
	collaboration_id?: unknown;
	title?: unknown;
	status?: unknown;
	projection_revision?: unknown;
	channel_chat_id?: unknown;
	message_id?: unknown;
}

export class SqliteAdminModerationRepository implements AdminModerationRepository {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findByPublicToken(publicToken: string): Promise<AdminModerationTarget | undefined> {
		const rows = await this.boundary.query<AdminTargetRow>(
			`SELECT
				c.id AS collaboration_id,
				c.title,
				c.status,
				c.projection_revision,
				p.channel_chat_id,
				p.message_id
			FROM collaborations c
			LEFT JOIN channel_publications p ON p.collaboration_id = c.id
			WHERE c.public_token = ?
			LIMIT 1`,
			[publicToken],
		);
		const row = rows[0];
		if (row === undefined) return undefined;
		if (
			typeof row.collaboration_id !== "string" ||
			typeof row.title !== "string" ||
			typeof row.status !== "string" ||
			!STATUSES.has(row.status as AdminModerationStatus) ||
			!Number.isSafeInteger(row.projection_revision) ||
			(row.projection_revision as number) < 0 ||
			(row.channel_chat_id !== null && typeof row.channel_chat_id !== "string") ||
			(row.message_id !== null && (!Number.isSafeInteger(row.message_id) || (row.message_id as number) <= 0))
		) {
			throw new Error("admin moderation target row is corrupt");
		}
		return {
			collaborationId: row.collaboration_id,
			title: row.title,
			status: row.status as AdminModerationStatus,
			projectionRevision: row.projection_revision as number,
			channelChatId: row.channel_chat_id as string | null,
			messageId: row.message_id as number | null,
		};
	}

	async markHidden(input: Parameters<AdminModerationRepository["markHidden"]>[0]): Promise<boolean> {
		const result = await this.boundary.execute(
			`UPDATE collaborations
			SET hidden_from_status = status,
				status = 'hidden',
				hidden_at = ?,
				projection_revision = projection_revision + 1,
				updated_at = ?
			WHERE id = ?
			  AND status = ?
			  AND projection_revision = ?`,
			[
				input.hiddenAt,
				input.hiddenAt,
				input.collaborationId,
				input.expectedStatus,
				input.expectedProjectionRevision,
			],
		) as { changes?: number };
		return result.changes === 1;
	}

	async closePendingApplications(collaborationId: string): Promise<number> {
		const result = await this.boundary.execute(
			"UPDATE applications SET status = 'closed' WHERE collaboration_id = ? AND status = 'pending'",
			[collaborationId],
		) as { changes?: number };
		return result.changes ?? 0;
	}

	async supersedeOlderProjectionDeliveries(input: Parameters<AdminModerationRepository["supersedeOlderProjectionDeliveries"]>[0]): Promise<number> {
		const prefix = `channel:${input.collaborationId}:projection:`;
		const revisionStart = prefix.length + 1;
		const result = await this.boundary.execute(
			`UPDATE outbox_deliveries
			SET status = 'superseded',
				claim_token = NULL,
				dispatch_started_at = NULL,
				request_deadline_at = NULL,
				next_attempt_at = NULL,
				telegram_retry_after = NULL,
				last_error_kind = NULL,
				updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END
			WHERE kind = 'channel_edit'
			  AND status IN ('prepared', 'retryable_failed')
			  AND claim_token IS NULL
			  AND dispatch_started_at IS NULL
			  AND request_deadline_at IS NULL
			  AND substr(idempotency_key, 1, ?) = ?
			  AND length(substr(idempotency_key, ?)) > 0
			  AND substr(idempotency_key, ?) NOT GLOB '*[^0-9]*'
			  AND CAST(substr(idempotency_key, ?) AS INTEGER) < ?`,
			[
				input.updatedAt,
				input.updatedAt,
				prefix.length,
				prefix,
				revisionStart,
				revisionStart,
				revisionStart,
				input.beforeProjectionRevision,
			],
		) as { changes?: number };
		return result.changes ?? 0;
	}

	async attachDeleteDelivery(input: Parameters<AdminModerationRepository["attachDeleteDelivery"]>[0]): Promise<void> {
		const result = await this.boundary.execute(
			`UPDATE channel_publications
			SET last_delivery_id = ?,
				updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END
			WHERE collaboration_id = ? AND message_id IS NOT NULL`,
			[input.deliveryId, input.updatedAt, input.updatedAt, input.collaborationId],
		) as { changes?: number };
		if (result.changes !== 1) throw new Error("showcase publication is unavailable for moderation");
	}

	async appendAction(action: OperatorActionRecord): Promise<void> {
		await this.boundary.execute(
			`INSERT INTO operator_actions (
				id,
				actor_kind,
				actor_telegram_user_id,
				collaboration_id,
				action_type,
				reason,
				before_state_json,
				after_state_json,
				command_id,
				created_at
			) VALUES (?, 'admin', ?, ?, 'hide_collaboration', ?, ?, ?, ?, ?)`,
			[
				action.id,
				action.actorTelegramUserId,
				action.collaborationId,
				action.reason,
				action.beforeStateJson,
				action.afterStateJson,
				action.commandId,
				action.createdAt,
			],
		);
	}
}
