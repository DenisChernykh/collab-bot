import type {
	BrowseCollaborationRecord,
	BrowseSessionRecord,
	CollaborationBrowseRepository,
	FindBrowseCardByIdInput,
	FindNextBrowseCardInput,
} from "../../application/ports/collaboration-browse-repository.js";
import type {
	ApplicantSnapshot,
	ApplicationRecord,
	ApplicationSubmissionContext,
	ApplicationSubmissionStore,
	ApplicationTarget,
} from "../../application/applications/application-service.js";
import {
	parseCollaborationFormat,
	parseCollaborationStatus,
	parsePlatformType,
	parseProfileType,
	parseTargetProfileType,
	parseTopic,
} from "../../domain/value-objects/enums.js";
import type { DatabaseBoundary } from "./database-boundary.js";

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

interface SubmissionContextRow {
	actor_status?: unknown;
	applicant_profile_id?: unknown;
	applicant_type?: unknown;
	applicant_display_name?: unknown;
	applicant_description?: unknown;
	collaboration_id?: unknown;
	public_token?: unknown;
	author_profile_id?: unknown;
	author_telegram_user_id?: unknown;
	author_profile_status?: unknown;
	author_actor_status?: unknown;
	title?: unknown;
	status?: unknown;
	version?: unknown;
	target_profile_type?: unknown;
	slots_total?: unknown;
	response_deadline_at?: unknown;
	published_at?: unknown;
	publication_status?: unknown;
	publication_message_id?: unknown;
	existing_application_id?: unknown;
	accepted_count?: unknown;
}

interface ApplicantPlatformRow {
	platform_type?: unknown;
	url?: unknown;
	title?: unknown;
	audience_size?: unknown;
}

export class SqliteCollaborationBrowseRepository implements CollaborationBrowseRepository, ApplicationSubmissionStore {
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

	async findSubmissionContext(
		telegramUserId: string,
		collaborationId: string,
	): Promise<ApplicationSubmissionContext | undefined> {
		const rows = await this.boundary.query<SubmissionContextRow>(
			`SELECT
				actor.status AS actor_status,
				applicant.id AS applicant_profile_id,
				applicant.type AS applicant_type,
				applicant.display_name AS applicant_display_name,
				applicant.description AS applicant_description,
				c.id AS collaboration_id,
				c.public_token,
				c.author_profile_id,
				author.telegram_user_id AS author_telegram_user_id,
				author.status AS author_profile_status,
				author_actor.status AS author_actor_status,
				c.title,
				c.status,
				c.version,
				c.target_profile_type,
				c.slots_total,
				c.response_deadline_at,
				c.published_at,
				publication.status AS publication_status,
				publication.message_id AS publication_message_id,
				(
					SELECT application.id
					FROM applications application
					WHERE application.collaboration_id = c.id
					  AND application.applicant_profile_id = applicant.id
					LIMIT 1
				) AS existing_application_id,
				(
					SELECT count(*)
					FROM applications accepted
					WHERE accepted.collaboration_id = c.id AND accepted.status = 'accepted'
				) AS accepted_count
			FROM telegram_users actor
			LEFT JOIN profiles applicant
				ON applicant.telegram_user_id = actor.telegram_user_id AND applicant.status = 'active'
			LEFT JOIN collaborations c ON c.id = ?
			LEFT JOIN profiles author ON author.id = c.author_profile_id
			LEFT JOIN telegram_users author_actor ON author_actor.telegram_user_id = author.telegram_user_id
			LEFT JOIN channel_publications publication ON publication.collaboration_id = c.id
			WHERE actor.telegram_user_id = ?
			LIMIT 1`,
			[collaborationId, telegramUserId],
		);
		const row = rows[0];
		if (row === undefined) return undefined;
		if (row.actor_status !== "active" && row.actor_status !== "blocked") {
			throw new Error("application actor row is corrupt");
		}
		const applicant = row.applicant_profile_id === null
			? null
			: await this.readApplicant(row);
		if ((row.existing_application_id !== null && typeof row.existing_application_id !== "string") || !Number.isSafeInteger(row.accepted_count) || (row.accepted_count as number) < 0) {
			throw new Error("application submission context is corrupt");
		}
		return {
			actorStatus: row.actor_status,
			applicant,
			target: mapApplicationTarget(row),
			existingApplicationId: row.existing_application_id as string | null,
			acceptedCount: row.accepted_count as number,
		};
	}

	async insertPending(record: ApplicationRecord): Promise<void> {
		await this.boundary.execute(
			`INSERT INTO applications (
				id, collaboration_id, applicant_profile_id, message, terms_version,
				collaboration_version, status, decided_by_profile_id, decided_at, created_at
			) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
			[
				record.id,
				record.collaborationId,
				record.applicantProfileId,
				record.message,
				record.termsVersion,
				record.collaborationVersion,
				record.createdAt,
			],
		);
	}

	async setFirstApplicationAt(collaborationId: string, firstApplicationAt: number): Promise<boolean> {
		const result = await this.boundary.execute(
			`UPDATE collaborations
			SET first_application_at = ?,
				updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END
			WHERE id = ? AND first_application_at IS NULL`,
			[firstApplicationAt, firstApplicationAt, firstApplicationAt, collaborationId],
		) as { changes?: number };
		return result.changes === 1;
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

	private async readApplicant(row: SubmissionContextRow): Promise<ApplicantSnapshot> {
		if (
			typeof row.applicant_profile_id !== "string" || typeof row.applicant_type !== "string" ||
			typeof row.applicant_display_name !== "string" ||
			(row.applicant_description !== null && typeof row.applicant_description !== "string")
		) throw new Error("application applicant row is corrupt");
		const platformRows = await this.boundary.query<ApplicantPlatformRow>(
			"SELECT platform_type, url, title, audience_size FROM profile_platforms WHERE profile_id = ? ORDER BY id LIMIT 1",
			[row.applicant_profile_id],
		);
		const platform = platformRows[0];
		if (
			platform === undefined || typeof platform.platform_type !== "string" || typeof platform.url !== "string" ||
			(platform.title !== null && typeof platform.title !== "string") ||
			(platform.audience_size !== null && (!Number.isSafeInteger(platform.audience_size) || (platform.audience_size as number) < 0))
		) throw new Error("application applicant platform row is corrupt");
		const topicRows = await this.boundary.query<TopicRow>(
			"SELECT topic FROM profile_topics WHERE profile_id = ? ORDER BY topic",
			[row.applicant_profile_id],
		);
		return {
			profileId: row.applicant_profile_id,
			type: parseProfileType(row.applicant_type),
			displayName: row.applicant_display_name,
			description: row.applicant_description as string | null,
			topics: topicRows.map((topic) => parseTopic(topic.topic)),
			platform: {
				platformType: parsePlatformType(platform.platform_type),
				url: platform.url,
				title: platform.title as string | null,
				audienceSize: platform.audience_size as number | null,
			},
		};
	}
}

function mapApplicationTarget(row: SubmissionContextRow): ApplicationTarget | null {
	if (row.collaboration_id === null) return null;
	if (
		typeof row.collaboration_id !== "string" ||
		(row.public_token !== null && typeof row.public_token !== "string") ||
		typeof row.author_profile_id !== "string" || typeof row.author_telegram_user_id !== "string" ||
		(row.author_profile_status !== "active" && row.author_profile_status !== "archived") ||
		(row.author_actor_status !== "active" && row.author_actor_status !== "blocked") ||
		(row.title !== null && typeof row.title !== "string") || typeof row.status !== "string" ||
		!Number.isSafeInteger(row.version) || (row.target_profile_type !== null && typeof row.target_profile_type !== "string") ||
		(row.slots_total !== null && !Number.isSafeInteger(row.slots_total)) ||
		(row.response_deadline_at !== null && !Number.isSafeInteger(row.response_deadline_at)) ||
		(row.published_at !== null && !Number.isSafeInteger(row.published_at)) ||
		(row.publication_status !== null && typeof row.publication_status !== "string") ||
		(row.publication_message_id !== null && !Number.isSafeInteger(row.publication_message_id))
	) return null;
	return {
		collaborationId: row.collaboration_id,
		publicToken: row.public_token as string | null,
		authorProfileId: row.author_profile_id,
		authorTelegramUserId: row.author_telegram_user_id,
		authorProfileStatus: row.author_profile_status,
		authorActorStatus: row.author_actor_status,
		title: row.title as string | null,
		status: parseCollaborationStatus(row.status),
		version: row.version as number,
		targetProfileType: row.target_profile_type === null ? null : parseTargetProfileType(row.target_profile_type),
		slotsTotal: row.slots_total as number | null,
		responseDeadlineAt: row.response_deadline_at as number | null,
		publishedAt: row.published_at as number | null,
		publicationStatus: row.publication_status as string | null,
		publicationMessageId: row.publication_message_id as number | null,
	};
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
