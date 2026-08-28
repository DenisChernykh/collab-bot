import type {
	ApplicantSnapshot,
	ApplicationDecisionCollaboration,
	ApplicationDecisionContext,
	ApplicationDecisionRecord,
	ApplicationNotificationSnapshot,
	ApplicationRecord,
	ApplicationSubmissionContext,
	ApplicationTarget,
	AuthorManagementView,
	OwnApplicationSummary,
	PairContactContext,
	RecruitmentDecisionContext,
	TelegramIdentitySnapshot,
} from "../application/application-contracts.js";
import type { ApplicationDecisionStore } from "../application/application-feature.js";
import {
	parseApplicationStatus,
	parseCollaborationFormat,
	parseCollaborationStatus,
	parsePlatformType,
	parseProfileType,
	parseTargetProfileType,
	parseTopic,
} from "../../../shared/domain/value-objects/enums.js";
import type { DatabaseBoundary } from "../../../platform/database/database-boundary.js";

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

interface DecisionApplicationRow {
	application_id?: unknown;
	application_collaboration_id?: unknown;
	applicant_profile_id?: unknown;
	applicant_telegram_user_id?: unknown;
	application_message?: unknown;
	application_status?: unknown;
	decided_by_profile_id?: unknown;
	decided_at?: unknown;
	application_created_at?: unknown;
}

interface DecisionAggregateRow extends DecisionApplicationRow {
	actor_status?: unknown;
	actor_telegram_user_id?: unknown;
	author_profile_id?: unknown;
	author_telegram_user_id?: unknown;
	author_username?: unknown;
	applicant_profile_status?: unknown;
	applicant_actor_status?: unknown;
	applicant_username?: unknown;
	collaboration_id?: unknown;
	public_token?: unknown;
	title?: unknown;
	format?: unknown;
	target_profile_type?: unknown;
	offer_text?: unknown;
	expectation_text?: unknown;
	slots_total?: unknown;
	response_deadline_at?: unknown;
	event_date_local?: unknown;
	city_code?: unknown;
	collaboration_status?: unknown;
	version?: unknown;
	projection_revision?: unknown;
	published_at?: unknown;
	matched_at?: unknown;
	updated_at?: unknown;
	publication_status?: unknown;
	channel_chat_id?: unknown;
	publication_message_id?: unknown;
	accepted_count?: unknown;
}

interface NotificationRow extends DecisionApplicationRow {
	applicant_username?: unknown;
}

interface PairContactRow {
	application_status?: unknown;
	author_telegram_user_id?: unknown;
	author_username?: unknown;
	applicant_telegram_user_id?: unknown;
	applicant_username?: unknown;
}

interface OwnApplicationRow {
	application_id?: unknown;
	collaboration_id?: unknown;
	collaboration_title?: unknown;
	collaboration_status?: unknown;
	application_status?: unknown;
	application_created_at?: unknown;
}

interface AuthorManagementRow {
	collaboration_id?: unknown;
	public_token?: unknown;
	title?: unknown;
	collaboration_status?: unknown;
	slots_total?: unknown;
	accepted_count?: unknown;
	projection_revision?: unknown;
}

interface AuthorApplicationRow extends SubmissionContextRow {
	application_id?: unknown;
	application_message?: unknown;
	application_status?: unknown;
	application_created_at?: unknown;
}

interface VersionRow { projection_revision?: unknown }

export class SqliteApplicationsRepository implements ApplicationDecisionStore {
	constructor(private readonly boundary: DatabaseBoundary) {}

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

	async findDecisionContext(
		telegramUserId: string,
		applicationId: string,
	): Promise<ApplicationDecisionContext | undefined> {
		const rows = await this.boundary.query<DecisionAggregateRow>(
			`${this.decisionCollaborationSelectSql(`applications application
				JOIN profiles applicant ON applicant.id = application.applicant_profile_id
				JOIN telegram_users applicant_actor ON applicant_actor.telegram_user_id = applicant.telegram_user_id
				JOIN collaborations c ON c.id = application.collaboration_id
				JOIN profiles author ON author.id = c.author_profile_id AND author.status = 'active'
				JOIN telegram_users author_actor ON author_actor.telegram_user_id = author.telegram_user_id
				JOIN telegram_users actor ON actor.telegram_user_id = ?
				LEFT JOIN channel_publications publication ON publication.collaboration_id = c.id`, true)}
			WHERE application.id = ?
			LIMIT 1`,
			[telegramUserId, applicationId],
		);
		const row = rows[0];
		if (row === undefined) return undefined;
		const application = mapDecisionApplication(row);
		const collaboration = await this.readDecisionCollaboration(row);
		if (
			application === undefined || collaboration === undefined ||
			(row.actor_status !== "active" && row.actor_status !== "blocked") ||
			typeof row.actor_telegram_user_id !== "string" ||
			typeof row.author_profile_id !== "string" ||
			(row.applicant_profile_status !== "active" && row.applicant_profile_status !== "archived") ||
			(row.applicant_actor_status !== "active" && row.applicant_actor_status !== "blocked") ||
			!isNonnegativeInteger(row.accepted_count)
		) return undefined;
		return {
			actorStatus: row.actor_status,
			actorTelegramUserId: row.actor_telegram_user_id,
			authorProfileId: row.author_profile_id,
			authorIdentity: mapIdentity(row.author_telegram_user_id, row.author_username),
			applicantProfileStatus: row.applicant_profile_status,
			applicantActorStatus: row.applicant_actor_status,
			applicantIdentity: mapIdentity(row.applicant_telegram_user_id, row.applicant_username),
			application,
			collaboration,
			acceptedCount: row.accepted_count,
		};
	}

	async findRecruitmentContext(
		telegramUserId: string,
		collaborationId: string,
	): Promise<RecruitmentDecisionContext | undefined> {
		const rows = await this.boundary.query<DecisionAggregateRow>(
			`${this.decisionCollaborationSelectSql(`collaborations c
				JOIN profiles author ON author.id = c.author_profile_id AND author.status = 'active'
				JOIN telegram_users author_actor ON author_actor.telegram_user_id = author.telegram_user_id
				JOIN telegram_users actor ON actor.telegram_user_id = ?
				LEFT JOIN channel_publications publication ON publication.collaboration_id = c.id`, false)}
			WHERE c.id = ?
			LIMIT 1`,
			[telegramUserId, collaborationId],
		);
		const row = rows[0];
		if (row === undefined) return undefined;
		const collaboration = await this.readDecisionCollaboration(row);
		if (
			collaboration === undefined ||
			(row.actor_status !== "active" && row.actor_status !== "blocked") ||
			typeof row.actor_telegram_user_id !== "string" ||
			typeof row.author_profile_id !== "string" ||
			!isNonnegativeInteger(row.accepted_count)
		) return undefined;
		return {
			actorStatus: row.actor_status,
			actorTelegramUserId: row.actor_telegram_user_id,
			authorProfileId: row.author_profile_id,
			authorIdentity: mapIdentity(row.author_telegram_user_id, row.author_username),
			collaboration,
			acceptedCount: row.accepted_count,
		};
	}

	async updateApplicationDecision(input: {
		readonly applicationId: string;
		readonly status: "accepted" | "rejected" | "closed";
		readonly decidedByProfileId: string | null;
		readonly decidedAt: number | null;
	}): Promise<boolean> {
		const result = await this.boundary.execute(
			`UPDATE applications
			SET status = ?, decided_by_profile_id = ?, decided_at = ?
			WHERE id = ? AND status = 'pending'`,
			[input.status, input.decidedByProfileId, input.decidedAt, input.applicationId],
		) as { changes?: number };
		return result.changes === 1;
	}

	async closePendingApplications(collaborationId: string): Promise<readonly ApplicationNotificationSnapshot[]> {
		const pending = await this.listNotificationSnapshots(collaborationId, "pending");
		if (pending.length === 0) return [];
		const result = await this.boundary.execute(
			`UPDATE applications
			SET status = 'closed', decided_by_profile_id = NULL, decided_at = NULL
			WHERE collaboration_id = ? AND status = 'pending'`,
			[collaborationId],
		) as { changes?: number };
		if (result.changes !== pending.length) throw new Error("pending application close set changed during serialized decision");
		return pending.map((item) => ({
			...item,
			application: { ...item.application, status: "closed" },
		}));
	}

	listAcceptedApplications(collaborationId: string): Promise<readonly ApplicationNotificationSnapshot[]> {
		return this.listNotificationSnapshots(collaborationId, "accepted");
	}

	async updateCollaborationDecision(input: {
		readonly collaborationId: string;
		readonly expectedProjectionRevision: number;
		readonly status: "published" | "matched";
		readonly matchedAt: number | null;
		readonly projectionRevision: number;
		readonly updatedAt: number;
	}): Promise<boolean> {
		if (input.projectionRevision !== input.expectedProjectionRevision + 1) return false;
		if ((input.status === "matched") !== (input.matchedAt !== null)) return false;
		const result = await this.boundary.execute(
			`UPDATE collaborations
			SET status = ?, matched_at = ?, projection_revision = ?,
				updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END
			WHERE id = ?
			  AND status = 'published'
			  AND matched_at IS NULL
			  AND projection_revision = ?`,
			[
				input.status,
				input.matchedAt,
				input.projectionRevision,
				input.updatedAt,
				input.updatedAt,
				input.collaborationId,
				input.expectedProjectionRevision,
			],
		) as { changes?: number };
		return result.changes === 1;
	}

	async supersedeOlderProjectionDeliveries(input: {
		readonly collaborationId: string;
		readonly beforeProjectionRevision: number;
		readonly updatedAt: number;
	}): Promise<number> {
		if (
			input.collaborationId.length === 0 ||
			!isNonnegativeInteger(input.beforeProjectionRevision) ||
			!isNonnegativeInteger(input.updatedAt)
		) throw new RangeError("projection supersede input is invalid");
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

	async supersedeStaleProjectionDeliveries(updatedAt: number): Promise<number> {
		if (!isNonnegativeInteger(updatedAt)) throw new RangeError("projection supersede timestamp is invalid");
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
			  AND EXISTS (
				SELECT 1
				FROM collaborations c
				WHERE substr(
					outbox_deliveries.idempotency_key,
					1,
					length('channel:' || c.id || ':projection:')
				) = 'channel:' || c.id || ':projection:'
				  AND length(substr(
					outbox_deliveries.idempotency_key,
					length('channel:' || c.id || ':projection:') + 1
				  )) > 0
				  AND substr(
					outbox_deliveries.idempotency_key,
					length('channel:' || c.id || ':projection:') + 1
				  ) NOT GLOB '*[^0-9]*'
				  AND CAST(substr(
					outbox_deliveries.idempotency_key,
					length('channel:' || c.id || ':projection:') + 1
				  ) AS INTEGER) < c.projection_revision
			  )`,
			[updatedAt, updatedAt],
		) as { changes?: number };
		return result.changes ?? 0;
	}

	async findPairContactContext(
		telegramUserId: string,
		applicationId: string,
	): Promise<PairContactContext | undefined> {
		const rows = await this.boundary.query<PairContactRow>(
			`SELECT
				application.status AS application_status,
				author.telegram_user_id AS author_telegram_user_id,
				author_actor.username AS author_username,
				applicant.telegram_user_id AS applicant_telegram_user_id,
				applicant_actor.username AS applicant_username
			FROM applications application
			JOIN collaborations c ON c.id = application.collaboration_id
			JOIN profiles author ON author.id = c.author_profile_id
			JOIN telegram_users author_actor ON author_actor.telegram_user_id = author.telegram_user_id
			JOIN profiles applicant ON applicant.id = application.applicant_profile_id
			JOIN telegram_users applicant_actor ON applicant_actor.telegram_user_id = applicant.telegram_user_id
			WHERE application.id = ?
			LIMIT 1`,
			[applicationId],
		);
		const row = rows[0];
		if (row === undefined) return undefined;
		const status = parseApplicationStatus(row.application_status);
		if (status !== "accepted") return { authorized: false, reason: "not_accepted" };
		if (telegramUserId === row.author_telegram_user_id) {
			return { authorized: true, counterpartIdentity: mapIdentity(row.applicant_telegram_user_id, row.applicant_username) };
		}
		if (telegramUserId === row.applicant_telegram_user_id) {
			return { authorized: true, counterpartIdentity: mapIdentity(row.author_telegram_user_id, row.author_username) };
		}
		return { authorized: false, reason: "not_pair" };
	}

	async findCurrentActionVersion(entityId: string): Promise<number | undefined> {
		let rows: readonly VersionRow[];
		if (entityId.startsWith("application:")) {
			rows = await this.boundary.query<VersionRow>(
				`SELECT c.projection_revision
				FROM applications application
				JOIN collaborations c ON c.id = application.collaboration_id
				WHERE application.id = ?
				LIMIT 1`,
				[entityId.slice("application:".length)],
			);
		} else if (entityId.startsWith("collaboration:")) {
			rows = await this.boundary.query<VersionRow>(
				"SELECT projection_revision FROM collaborations WHERE id = ? LIMIT 1",
				[entityId.slice("collaboration:".length)],
			);
		} else {
			return undefined;
		}
		return isNonnegativeInteger(rows[0]?.projection_revision) ? rows[0]?.projection_revision : undefined;
	}

	async listOwnApplications(telegramUserId: string): Promise<readonly OwnApplicationSummary[]> {
		const rows = await this.boundary.query<OwnApplicationRow>(
			`SELECT
				application.id AS application_id,
				application.collaboration_id,
				c.title AS collaboration_title,
				c.status AS collaboration_status,
				application.status AS application_status,
				application.created_at AS application_created_at
			FROM applications application
			JOIN profiles applicant ON applicant.id = application.applicant_profile_id
			JOIN collaborations c ON c.id = application.collaboration_id
			WHERE applicant.telegram_user_id = ?
			ORDER BY application.created_at DESC, application.id DESC`,
			[telegramUserId],
		);
		return rows.map(mapOwnApplication);
	}

	findAuthorManagement(
		telegramUserId: string,
		collaborationId: string,
	): Promise<AuthorManagementView | undefined> {
		return this.findOneAuthorManagement("c.id = ?", [telegramUserId, collaborationId]);
	}

	findAuthorManagementByPublicToken(
		telegramUserId: string,
		publicToken: string,
	): Promise<AuthorManagementView | undefined> {
		return this.findOneAuthorManagement("c.public_token = ?", [telegramUserId, publicToken]);
	}

	async listAuthorManagement(telegramUserId: string): Promise<readonly AuthorManagementView[]> {
		const rows = await this.boundary.query<AuthorManagementRow>(
			`${this.authorManagementSelectSql()}
			WHERE author.telegram_user_id = ?
			  AND c.public_token IS NOT NULL
			  AND c.slots_total IS NOT NULL
			ORDER BY c.created_at DESC, c.id DESC`,
			[telegramUserId],
		);
		return Promise.all(rows.map((row) => this.readAuthorManagement(row)));
	}

	private decisionCollaborationSelectSql(fromSql: string, includeApplication: boolean): string {
		const applicationColumns = includeApplication
			? `application.id AS application_id,
				application.collaboration_id AS application_collaboration_id,
				application.applicant_profile_id,
				applicant.telegram_user_id AS applicant_telegram_user_id,
				application.message AS application_message,
				application.status AS application_status,
				application.decided_by_profile_id,
				application.decided_at,
				application.created_at AS application_created_at,
				applicant.status AS applicant_profile_status,
				applicant_actor.status AS applicant_actor_status,
				applicant_actor.username AS applicant_username,`
			: "";
		return `SELECT
			${applicationColumns}
			actor.status AS actor_status,
			actor.telegram_user_id AS actor_telegram_user_id,
			author.id AS author_profile_id,
			author.telegram_user_id AS author_telegram_user_id,
			author_actor.username AS author_username,
			c.id AS collaboration_id,
			c.public_token,
			c.title,
			c.format,
			c.target_profile_type,
			c.offer_text,
			c.expectation_text,
			c.slots_total,
			c.response_deadline_at,
			c.event_date_local,
			c.city_code,
			c.status AS collaboration_status,
			c.version,
			c.projection_revision,
			c.published_at,
			c.matched_at,
			c.updated_at,
			publication.status AS publication_status,
			publication.channel_chat_id,
			publication.message_id AS publication_message_id,
			(
				SELECT count(*)
				FROM applications accepted
				WHERE accepted.collaboration_id = c.id AND accepted.status = 'accepted'
			) AS accepted_count
		FROM ${fromSql}`;
	}

	private async readDecisionCollaboration(
		row: DecisionAggregateRow,
	): Promise<ApplicationDecisionCollaboration | undefined> {
		if (
			typeof row.collaboration_id !== "string" || typeof row.public_token !== "string" ||
			typeof row.author_profile_id !== "string" || !isTelegramUserId(row.author_telegram_user_id) ||
			typeof row.title !== "string" || typeof row.format !== "string" ||
			typeof row.target_profile_type !== "string" || typeof row.offer_text !== "string" ||
			typeof row.expectation_text !== "string" || !isPositiveInteger(row.slots_total) ||
			!isNonnegativeInteger(row.response_deadline_at) ||
			(row.event_date_local !== null && typeof row.event_date_local !== "string") ||
			row.city_code !== "ekaterinburg" || typeof row.collaboration_status !== "string" ||
			!isPositiveInteger(row.version) || !isNonnegativeInteger(row.projection_revision) ||
			!isNonnegativeInteger(row.published_at) ||
			(row.matched_at !== null && !isNonnegativeInteger(row.matched_at)) ||
			!isNonnegativeInteger(row.updated_at) || typeof row.publication_status !== "string" ||
			typeof row.channel_chat_id !== "string" || row.channel_chat_id.length === 0 ||
			!isPositiveInteger(row.publication_message_id)
		) return undefined;
		try {
			const topics = await this.boundary.query<TopicRow>(
				"SELECT topic FROM collaboration_topics WHERE collaboration_id = ? ORDER BY topic",
				[row.collaboration_id],
			);
			if (topics.length < 1 || topics.length > 3) return undefined;
			return {
				id: row.collaboration_id,
				publicToken: row.public_token,
				authorProfileId: row.author_profile_id,
				authorTelegramUserId: row.author_telegram_user_id,
				title: row.title,
				format: parseCollaborationFormat(row.format),
				targetProfileType: parseTargetProfileType(row.target_profile_type),
				topics: topics.map((topic) => parseTopic(topic.topic)),
				offerText: row.offer_text,
				expectationText: row.expectation_text,
				slotsTotal: row.slots_total,
				responseDeadlineAt: row.response_deadline_at,
				eventDateLocal: row.event_date_local as string | null,
				cityCode: "ekaterinburg",
				status: parseCollaborationStatus(row.collaboration_status),
				version: row.version,
				projectionRevision: row.projection_revision,
				publishedAt: row.published_at,
				matchedAt: row.matched_at as number | null,
				updatedAt: row.updated_at,
				publication: {
					status: row.publication_status,
					channelChatId: row.channel_chat_id,
					messageId: row.publication_message_id,
				},
				syncBlocked: row.publication_status !== "published",
			};
		} catch {
			return undefined;
		}
	}

	private async listNotificationSnapshots(
		collaborationId: string,
		status: "pending" | "accepted",
	): Promise<readonly ApplicationNotificationSnapshot[]> {
		const rows = await this.boundary.query<NotificationRow>(
			`SELECT
				application.id AS application_id,
				application.collaboration_id AS application_collaboration_id,
				application.applicant_profile_id,
				applicant.telegram_user_id AS applicant_telegram_user_id,
				application.message AS application_message,
				application.status AS application_status,
				application.decided_by_profile_id,
				application.decided_at,
				application.created_at AS application_created_at,
				applicant_actor.username AS applicant_username
			FROM applications application
			JOIN profiles applicant ON applicant.id = application.applicant_profile_id
			JOIN telegram_users applicant_actor ON applicant_actor.telegram_user_id = applicant.telegram_user_id
			WHERE application.collaboration_id = ? AND application.status = ?
			ORDER BY application.created_at, application.id`,
			[collaborationId, status],
		);
		const snapshots: ApplicationNotificationSnapshot[] = [];
		for (const row of rows) {
			const application = mapDecisionApplication(row);
			if (application === undefined) throw new Error("application notification row is corrupt");
			snapshots.push({
				application,
				applicantIdentity: mapIdentity(row.applicant_telegram_user_id, row.applicant_username),
			});
		}
		return snapshots;
	}

	private authorManagementSelectSql(): string {
		return `SELECT
			c.id AS collaboration_id,
			c.public_token,
			c.title,
			c.status AS collaboration_status,
			c.slots_total,
			c.projection_revision,
			(
				SELECT count(*)
				FROM applications accepted
				WHERE accepted.collaboration_id = c.id AND accepted.status = 'accepted'
			) AS accepted_count
		FROM collaborations c
		JOIN profiles author ON author.id = c.author_profile_id`;
	}

	private async findOneAuthorManagement(
		predicate: "c.id = ?" | "c.public_token = ?",
		parameters: readonly [string, string],
	): Promise<AuthorManagementView | undefined> {
		const rows = await this.boundary.query<AuthorManagementRow>(
			`${this.authorManagementSelectSql()}
			WHERE author.telegram_user_id = ?
			  AND ${predicate}
			  AND c.public_token IS NOT NULL
			  AND c.slots_total IS NOT NULL
			LIMIT 1`,
			parameters,
		);
		return rows[0] === undefined ? undefined : this.readAuthorManagement(rows[0]);
	}

	private async readAuthorManagement(row: AuthorManagementRow): Promise<AuthorManagementView> {
		if (
			typeof row.collaboration_id !== "string" || typeof row.public_token !== "string" ||
			(row.title !== null && typeof row.title !== "string") ||
			typeof row.collaboration_status !== "string" || !isPositiveInteger(row.slots_total) ||
			!isNonnegativeInteger(row.accepted_count) || !isNonnegativeInteger(row.projection_revision)
		) throw new Error("author management row is corrupt");
		const applicationRows = await this.boundary.query<AuthorApplicationRow>(
			`SELECT
				application.id AS application_id,
				application.message AS application_message,
				application.status AS application_status,
				application.created_at AS application_created_at,
				applicant.id AS applicant_profile_id,
				applicant.type AS applicant_type,
				applicant.display_name AS applicant_display_name,
				applicant.description AS applicant_description
			FROM applications application
			JOIN profiles applicant ON applicant.id = application.applicant_profile_id
			WHERE application.collaboration_id = ?
			ORDER BY application.created_at DESC, application.id DESC`,
			[row.collaboration_id],
		);
		const applications: AuthorManagementView["applications"][number][] = [];
		for (const applicationRow of applicationRows) {
			if (
				typeof applicationRow.application_id !== "string" ||
				typeof applicationRow.application_message !== "string" ||
				typeof applicationRow.application_status !== "string" ||
				!isNonnegativeInteger(applicationRow.application_created_at)
			) throw new Error("author application row is corrupt");
			const applicant = await this.readApplicant(applicationRow);
			applications.push({
				applicationId: applicationRow.application_id,
				message: applicationRow.application_message,
				status: parseApplicationStatus(applicationRow.application_status),
				createdAt: applicationRow.application_created_at,
				applicant: {
					type: applicant.type,
					displayName: applicant.displayName,
					description: applicant.description,
					topics: applicant.topics,
					platform: applicant.platform,
				},
			});
		}
		return {
			collaborationId: row.collaboration_id,
			publicToken: row.public_token,
			title: row.title as string | null,
			status: parseCollaborationStatus(row.collaboration_status),
			slotsTotal: row.slots_total,
			acceptedCount: row.accepted_count,
			projectionRevision: row.projection_revision,
			applications,
		};
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

function mapDecisionApplication(row: DecisionApplicationRow): ApplicationDecisionRecord | undefined {
	if (
		typeof row.application_id !== "string" ||
		typeof row.application_collaboration_id !== "string" ||
		typeof row.applicant_profile_id !== "string" ||
		!isTelegramUserId(row.applicant_telegram_user_id) ||
		typeof row.application_message !== "string" ||
		typeof row.application_status !== "string" ||
		(row.decided_by_profile_id !== null && typeof row.decided_by_profile_id !== "string") ||
		(row.decided_at !== null && !isNonnegativeInteger(row.decided_at)) ||
		!isNonnegativeInteger(row.application_created_at)
	) return undefined;
	try {
		const status = parseApplicationStatus(row.application_status);
		const decided = status === "accepted" || status === "rejected";
		if (
			decided !== (typeof row.decided_by_profile_id === "string") ||
			decided !== isNonnegativeInteger(row.decided_at)
		) return undefined;
		return {
			id: row.application_id,
			collaborationId: row.application_collaboration_id,
			applicantProfileId: row.applicant_profile_id,
			applicantTelegramUserId: row.applicant_telegram_user_id,
			message: row.application_message,
			status,
			decidedByProfileId: row.decided_by_profile_id as string | null,
			decidedAt: row.decided_at as number | null,
			createdAt: row.application_created_at,
		};
	} catch {
		return undefined;
	}
}

function mapIdentity(
	telegramUserId: unknown,
	username: unknown,
): TelegramIdentitySnapshot | undefined {
	if (!isTelegramUserId(telegramUserId) || (username !== null && typeof username !== "string")) return undefined;
	return { telegramUserId, username };
}

function mapOwnApplication(row: OwnApplicationRow): OwnApplicationSummary {
	if (
		typeof row.application_id !== "string" || typeof row.collaboration_id !== "string" ||
		(row.collaboration_title !== null && typeof row.collaboration_title !== "string") ||
		typeof row.collaboration_status !== "string" || typeof row.application_status !== "string" ||
		!isNonnegativeInteger(row.application_created_at)
	) throw new Error("own application row is corrupt");
	return {
		applicationId: row.application_id,
		collaborationId: row.collaboration_id,
		collaborationTitle: row.collaboration_title as string | null,
		collaborationStatus: parseCollaborationStatus(row.collaboration_status),
		status: parseApplicationStatus(row.application_status),
		createdAt: row.application_created_at,
	};
}

function isTelegramUserId(value: unknown): value is string {
	return typeof value === "string" && /^\d+$/.test(value);
}

function isNonnegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
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
