import { generateUuid } from "../../../platform/crypto/tokens.js";
import type { CollaborationRepository } from "../application/ports/collaboration-repository.js";
import {
	parseCollaborationFormat,
	parseCollaborationStatus,
	parseTargetProfileType,
	parseTopic,
} from "../../../shared/domain/value-objects/enums.js";
import {
	type CollaborationDraftInput,
	type CollaborationRecord,
} from "../domain/collaboration.js";
import type { DatabaseBoundary } from "../../../platform/database/database-boundary.js";

interface CollaborationRow {
	id?: unknown;
	public_token?: unknown;
	author_profile_id?: unknown;
	author_telegram_user_id?: unknown;
	format?: unknown;
	target_profile_type?: unknown;
	title?: unknown;
	offer_text?: unknown;
	expectation_text?: unknown;
	slots_total?: unknown;
	response_deadline_at?: unknown;
	event_date_local?: unknown;
	city_code?: unknown;
	status?: unknown;
	version?: unknown;
	projection_revision?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
}

interface TopicRow { topic?: unknown }

export class CollaborationRepositoryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CollaborationRepositoryError";
	}
}

export class SqliteCollaborationRepository implements CollaborationRepository {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findDraftByTelegramUserId(telegramUserId: string): Promise<CollaborationRecord | undefined> {
		const rows = await this.boundary.query<CollaborationRow>(this.selectSql("c.status = 'draft' AND p.telegram_user_id = ?"), [telegramUserId]);
		return rows[0] === undefined ? undefined : this.readAggregate(rows[0]);
	}

	async findDraftByIdForTelegramUser(telegramUserId: string, collaborationId: string): Promise<CollaborationRecord | undefined> {
		const rows = await this.boundary.query<CollaborationRow>(this.selectSql("c.status = 'draft' AND c.id = ? AND p.telegram_user_id = ?"), [collaborationId, telegramUserId]);
		return rows[0] === undefined ? undefined : this.readAggregate(rows[0]);
	}

	async findByIdForTelegramUser(telegramUserId: string, collaborationId: string): Promise<CollaborationRecord | undefined> {
		const rows = await this.boundary.query<CollaborationRow>(this.selectSql("c.id = ? AND p.telegram_user_id = ?"), [collaborationId, telegramUserId]);
		return rows[0] === undefined ? undefined : this.readAggregate(rows[0]);
	}

	async findById(collaborationId: string): Promise<CollaborationRecord | undefined> {
		const rows = await this.boundary.query<CollaborationRow>(this.selectSql("c.id = ?"), [collaborationId]);
		return rows[0] === undefined ? undefined : this.readAggregate(rows[0]);
	}

	async createDraft(telegramUserId: string, now: number): Promise<CollaborationRecord> {
		return this.boundary.withTransaction(async () => {
			const profileRows = await this.boundary.query<{ id?: unknown }>("SELECT id FROM profiles WHERE telegram_user_id = ? AND status = 'active'", [telegramUserId]);
			const profileId = profileRows[0]?.id;
			if (typeof profileId !== "string") throw new CollaborationRepositoryError("active profile is required");
			const id = generateUuid();
			try {
				await this.boundary.execute(
					"INSERT INTO collaborations (id, public_token, author_profile_id, format, target_profile_type, title, offer_text, expectation_text, slots_total, response_deadline_at, event_date_local, city_code, status, version, projection_revision, created_at, updated_at) VALUES (?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'draft', 1, 0, ?, ?)",
					[id, profileId, now, now],
				);
			} catch (error) {
				if (isUniqueConstraintError(error)) throw new CollaborationRepositoryError("active collaboration draft already exists");
				throw error;
			}
			const created = await this.findDraftByIdForTelegramUser(telegramUserId, id);
			if (created === undefined) throw new CollaborationRepositoryError("created collaboration draft could not be reloaded");
			return created;
		});
	}

	async replaceDraft(telegramUserId: string, collaborationId: string, input: CollaborationDraftInput, now: number): Promise<CollaborationRecord> {
		return this.boundary.withTransaction(async () => {
			const existing = await this.findDraftByIdForTelegramUser(telegramUserId, collaborationId);
			if (existing === undefined) throw new CollaborationRepositoryError("owned collaboration draft was not found");
			const complete = input.format !== undefined && input.targetProfileType !== undefined && input.topics !== undefined && input.title !== undefined && input.offerText !== undefined && input.expectationText !== undefined && input.slotsTotal !== undefined && input.responseDeadlineAt !== undefined;
			await this.boundary.execute(
				"UPDATE collaborations SET format = ?, target_profile_type = ?, title = ?, offer_text = ?, expectation_text = ?, slots_total = ?, response_deadline_at = ?, event_date_local = ?, city_code = ?, updated_at = ? WHERE id = ? AND status = 'draft' AND author_profile_id = (SELECT p.id FROM profiles p WHERE p.telegram_user_id = ? AND p.status = 'active')",
				[
					input.format ?? null,
					input.targetProfileType ?? null,
					input.title ?? null,
					input.offerText ?? null,
					input.expectationText ?? null,
					input.slotsTotal ?? null,
					input.responseDeadlineAt ?? null,
					input.eventDateLocal ?? null,
					complete ? "ekaterinburg" : null,
					now,
					collaborationId,
					telegramUserId,
				],
			);
			await this.boundary.execute("DELETE FROM collaboration_topics WHERE collaboration_id = ?", [collaborationId]);
			for (const topic of input.topics ?? []) await this.boundary.execute("INSERT INTO collaboration_topics (collaboration_id, topic) VALUES (?, ?)", [collaborationId, topic]);
			const updated = await this.findDraftByIdForTelegramUser(telegramUserId, collaborationId);
			if (updated === undefined) throw new CollaborationRepositoryError("updated collaboration draft could not be reloaded");
			return updated;
		});
	}

	async deleteDraft(telegramUserId: string, collaborationId: string): Promise<boolean> {
		return this.boundary.withTransaction(async () => {
			const result = await this.boundary.execute(
				"DELETE FROM collaborations WHERE id = ? AND status = 'draft' AND author_profile_id = (SELECT p.id FROM profiles p WHERE p.telegram_user_id = ? AND p.status = 'active')",
				[collaborationId, telegramUserId],
			) as { changes?: number };
			return result.changes === 1;
		});
	}

	private selectSql(predicate: string): string {
		return `SELECT c.id, c.public_token, c.author_profile_id, p.telegram_user_id AS author_telegram_user_id, c.format, c.target_profile_type, c.title, c.offer_text, c.expectation_text, c.slots_total, c.response_deadline_at, c.event_date_local, c.city_code, c.status, c.version, c.projection_revision, c.created_at, c.updated_at FROM collaborations c JOIN profiles p ON p.id = c.author_profile_id WHERE ${predicate} ORDER BY c.created_at DESC, c.id DESC LIMIT 1`;
	}

	private async readAggregate(row: CollaborationRow): Promise<CollaborationRecord> {
		const base = readBase(row);
		const topicRows = await this.boundary.query<TopicRow>("SELECT topic FROM collaboration_topics WHERE collaboration_id = ? ORDER BY topic", [base.id]);
		return { ...base, topics: topicRows.map((topic) => parseTopic(topic.topic)) };
	}
}

function readBase(row: CollaborationRow): Omit<CollaborationRecord, "topics"> {
	if (
		typeof row.id !== "string" || (row.public_token !== null && typeof row.public_token !== "string") ||
		typeof row.author_profile_id !== "string" || typeof row.author_telegram_user_id !== "string" ||
		(row.format !== null && typeof row.format !== "string") || (row.target_profile_type !== null && typeof row.target_profile_type !== "string") ||
		(row.title !== null && typeof row.title !== "string") || (row.offer_text !== null && typeof row.offer_text !== "string") ||
		(row.expectation_text !== null && typeof row.expectation_text !== "string") || (row.slots_total !== null && !Number.isSafeInteger(row.slots_total)) ||
		(row.response_deadline_at !== null && !Number.isSafeInteger(row.response_deadline_at)) || (row.event_date_local !== null && typeof row.event_date_local !== "string") ||
		(row.city_code !== null && row.city_code !== "ekaterinburg") || typeof row.status !== "string" || !Number.isSafeInteger(row.version) || !Number.isSafeInteger(row.projection_revision) ||
		!Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.updated_at)
	) throw new CollaborationRepositoryError("collaboration row is corrupt");
	const status = parseCollaborationStatus(row.status);
	return {
		id: row.id,
		publicToken: row.public_token as string | null,
		authorProfileId: row.author_profile_id,
		authorTelegramUserId: row.author_telegram_user_id,
		format: row.format === null ? null : parseCollaborationFormat(row.format),
		targetProfileType: row.target_profile_type === null ? null : parseTargetProfileType(row.target_profile_type),
		title: row.title as string | null,
		offerText: row.offer_text as string | null,
		expectationText: row.expectation_text as string | null,
		slotsTotal: row.slots_total as number | null,
		responseDeadlineAt: row.response_deadline_at as number | null,
		eventDateLocal: row.event_date_local as string | null,
		cityCode: row.city_code as "ekaterinburg" | null,
		status,
		version: row.version as number,
		projectionRevision: row.projection_revision as number,
		createdAt: row.created_at as number,
		updatedAt: row.updated_at as number,
	};
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique constraint failed/i.test(error.message);
}
