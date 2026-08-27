import type {
	BrowseCollaborationRecord,
	BrowseSessionRecord,
	CollaborationBrowseRepository,
	FindBrowseCardByIdInput,
	FindNextBrowseCardInput,
} from "../application/ports/collaboration-browse-repository.js";
import {
	parseCollaborationFormat,
	parseCollaborationStatus,
	parseProfileType,
	parseTargetProfileType,
	parseTopic,
} from "../../../domain/value-objects/enums.js";
import type { DatabaseBoundary } from "../../../infrastructure/database/database-boundary.js";

interface BrowseSessionRow {
	telegram_user_id?: unknown;
	generation?: unknown;
	target_profile_type_filter?: unknown;
	format_filter?: unknown;
	topic_filter?: unknown;
	cursor_published_at?: unknown;
	cursor_collaboration_id?: unknown;
	revision?: unknown;
	expires_at?: unknown;
	updated_at?: unknown;
}

interface BrowseCardRow {
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
	published_at?: unknown;
}

interface TopicRow { topic?: unknown }

export class SqliteCollaborationBrowseRepository implements CollaborationBrowseRepository {
	constructor(private readonly boundary: DatabaseBoundary) {}

	async findSession(telegramUserId: string): Promise<BrowseSessionRecord | undefined> {
		const rows = await this.boundary.query<BrowseSessionRow>(
			"SELECT telegram_user_id, generation, target_profile_type_filter, format_filter, topic_filter, cursor_published_at, cursor_collaboration_id, revision, expires_at, updated_at FROM browse_sessions WHERE telegram_user_id = ?",
			[telegramUserId],
		);
		return rows[0] === undefined ? undefined : mapSession(rows[0]);
	}

	async saveSession(session: BrowseSessionRecord): Promise<void> {
		await this.boundary.execute(
			`INSERT INTO browse_sessions (
				telegram_user_id, generation, target_profile_type_filter, format_filter, topic_filter,
				cursor_published_at, cursor_collaboration_id, revision, expires_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(telegram_user_id) DO UPDATE SET
				generation = excluded.generation,
				target_profile_type_filter = excluded.target_profile_type_filter,
				format_filter = excluded.format_filter,
				topic_filter = excluded.topic_filter,
				cursor_published_at = excluded.cursor_published_at,
				cursor_collaboration_id = excluded.cursor_collaboration_id,
				revision = excluded.revision,
				expires_at = excluded.expires_at,
				updated_at = excluded.updated_at`,
			[
				session.telegramUserId,
				session.generation,
				session.filters.targetProfileType,
				session.filters.format,
				session.filters.topic,
				session.cursor?.publishedAt ?? null,
				session.cursor?.collaborationId ?? null,
				session.revision,
				session.expiresAt,
				session.updatedAt,
			],
		);
	}

	async deleteExpiredSessions(now: number, limit: number): Promise<number> {
		if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("browse session cleanup bounds are invalid");
		const result = await this.boundary.execute(
			`DELETE FROM browse_sessions
			WHERE telegram_user_id IN (
				SELECT telegram_user_id
				FROM browse_sessions
				WHERE expires_at <= ?
				ORDER BY expires_at, telegram_user_id
				LIMIT ?
			)`,
			[now, limit],
		) as { changes?: number };
		return result.changes ?? 0;
	}

	async findNextEligible(input: FindNextBrowseCardInput): Promise<BrowseCollaborationRecord | undefined> {
		const { predicates, parameters } = this.eligibilityPredicate(input);
		if (input.cursor !== null) {
			predicates.push("(c.published_at < ? OR (c.published_at = ? AND c.id < ?))");
			parameters.push(input.cursor.publishedAt, input.cursor.publishedAt, input.cursor.collaborationId);
		}
		const rows = await this.boundary.query<BrowseCardRow>(
			`${this.selectSql()} WHERE ${predicates.join(" AND ")} ORDER BY c.published_at DESC, c.id DESC LIMIT 1`,
			parameters,
		);
		return rows[0] === undefined ? undefined : this.readCard(rows[0]);
	}

	async findEligibleById(input: FindBrowseCardByIdInput): Promise<BrowseCollaborationRecord | undefined> {
		const { predicates, parameters } = this.eligibilityPredicate(input);
		predicates.push("c.id = ?");
		parameters.push(input.collaborationId);
		const rows = await this.boundary.query<BrowseCardRow>(
			`${this.selectSql()} WHERE ${predicates.join(" AND ")} LIMIT 1`,
			parameters,
		);
		return rows[0] === undefined ? undefined : this.readCard(rows[0]);
	}

	async findByPublicToken(publicToken: string): Promise<BrowseCollaborationRecord | undefined> {
		const rows = await this.boundary.query<BrowseCardRow>(`${this.selectSql()} WHERE c.public_token = ? LIMIT 1`, [publicToken]);
		return rows[0] === undefined ? undefined : this.readCard(rows[0]);
	}

	private selectSql(): string {
		return `SELECT
			c.id, c.public_token, c.author_profile_id, author.telegram_user_id AS author_telegram_user_id,
			c.format, c.target_profile_type, c.title, c.offer_text, c.expectation_text, c.slots_total,
			c.response_deadline_at, c.event_date_local, c.city_code, c.status, c.version,
			c.projection_revision, c.created_at, c.updated_at, c.published_at
		FROM collaborations c
		JOIN profiles author ON author.id = c.author_profile_id`;
	}

	private eligibilityPredicate(input: Pick<FindNextBrowseCardInput, "viewerTelegramUserId" | "now" | "filters">): {
		predicates: string[];
		parameters: (string | number)[];
	} {
		const predicates = [
			"c.status = 'published'",
			"c.published_at IS NOT NULL",
			"c.response_deadline_at >= ?",
			"author.telegram_user_id <> ?",
			"author.status = 'active'",
			"EXISTS (SELECT 1 FROM telegram_users author_actor WHERE author_actor.telegram_user_id = author.telegram_user_id AND author_actor.status = 'active')",
			"c.slots_total IS NOT NULL",
			"(SELECT count(*) FROM applications accepted WHERE accepted.collaboration_id = c.id AND accepted.status = 'accepted') < c.slots_total",
			"NOT EXISTS (SELECT 1 FROM applications used JOIN profiles used_profile ON used_profile.id = used.applicant_profile_id WHERE used.collaboration_id = c.id AND used_profile.telegram_user_id = ?)",
		];
		const parameters: (string | number)[] = [input.now, input.viewerTelegramUserId, input.viewerTelegramUserId];
		if (input.filters.targetProfileType !== null) {
			predicates.push("(c.target_profile_type = ? OR c.target_profile_type = 'any')");
			parameters.push(input.filters.targetProfileType);
		}
		if (input.filters.format !== null) {
			predicates.push("c.format = ?");
			parameters.push(input.filters.format);
		}
		if (input.filters.topic !== null) {
			predicates.push("EXISTS (SELECT 1 FROM collaboration_topics filter_topic WHERE filter_topic.collaboration_id = c.id AND filter_topic.topic = ?)");
			parameters.push(input.filters.topic);
		}
		return { predicates, parameters };
	}

	private async readCard(row: BrowseCardRow): Promise<BrowseCollaborationRecord> {
		const base = mapCard(row);
		const topics = await this.boundary.query<TopicRow>("SELECT topic FROM collaboration_topics WHERE collaboration_id = ? ORDER BY topic", [base.id]);
		return { ...base, topics: topics.map((row) => parseTopic(row.topic)) };
	}
}

function mapSession(row: BrowseSessionRow): BrowseSessionRecord {
	if (
		typeof row.telegram_user_id !== "string" ||
		typeof row.generation !== "string" || !/^[0-9a-f]{16}$/.test(row.generation) ||
		(row.target_profile_type_filter !== null && typeof row.target_profile_type_filter !== "string") ||
		(row.format_filter !== null && typeof row.format_filter !== "string") ||
		(row.topic_filter !== null && typeof row.topic_filter !== "string") ||
		(row.cursor_published_at !== null && !Number.isSafeInteger(row.cursor_published_at)) ||
		(row.cursor_collaboration_id !== null && typeof row.cursor_collaboration_id !== "string") ||
		((row.cursor_published_at === null) !== (row.cursor_collaboration_id === null)) ||
		!Number.isSafeInteger(row.revision) || !Number.isSafeInteger(row.expires_at) || !Number.isSafeInteger(row.updated_at)
	) throw new Error("browse session row is corrupt");
	return {
		telegramUserId: row.telegram_user_id,
		generation: row.generation,
		filters: {
			targetProfileType: row.target_profile_type_filter === null ? null : parseProfileType(row.target_profile_type_filter),
			format: row.format_filter === null ? null : parseCollaborationFormat(row.format_filter),
			topic: row.topic_filter === null ? null : parseTopic(row.topic_filter),
		},
		cursor: row.cursor_published_at === null ? null : {
			publishedAt: row.cursor_published_at as number,
			collaborationId: row.cursor_collaboration_id as string,
		},
		revision: row.revision as number,
		expiresAt: row.expires_at as number,
		updatedAt: row.updated_at as number,
	};
}

function mapCard(row: BrowseCardRow): Omit<BrowseCollaborationRecord, "topics"> {
	if (
		typeof row.id !== "string" || (row.public_token !== null && typeof row.public_token !== "string") ||
		typeof row.author_profile_id !== "string" || typeof row.author_telegram_user_id !== "string" ||
		(row.format !== null && typeof row.format !== "string") || (row.target_profile_type !== null && typeof row.target_profile_type !== "string") ||
		(row.title !== null && typeof row.title !== "string") || (row.offer_text !== null && typeof row.offer_text !== "string") ||
		(row.expectation_text !== null && typeof row.expectation_text !== "string") || (row.slots_total !== null && !Number.isSafeInteger(row.slots_total)) ||
		(row.response_deadline_at !== null && !Number.isSafeInteger(row.response_deadline_at)) || (row.event_date_local !== null && typeof row.event_date_local !== "string") ||
		(row.city_code !== null && row.city_code !== "ekaterinburg") || typeof row.status !== "string" ||
		!Number.isSafeInteger(row.version) || !Number.isSafeInteger(row.projection_revision) || !Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.updated_at) ||
		(row.published_at !== null && !Number.isSafeInteger(row.published_at))
	) throw new Error("browse collaboration row is corrupt");
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
		status: parseCollaborationStatus(row.status),
		version: row.version as number,
		projectionRevision: row.projection_revision as number,
		createdAt: row.created_at as number,
		updatedAt: row.updated_at as number,
		publishedAt: row.published_at as number | null,
	};
}
