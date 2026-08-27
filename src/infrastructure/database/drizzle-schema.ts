import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const telegramUsers = sqliteTable(
	"telegram_users",
	{
		telegramUserId: text("telegram_user_id").primaryKey(),
		username: text("username"),
		displayName: text("display_name").notNull(),
		status: text("status", { enum: ["active", "blocked"] as const }).notNull(),
		blockedAt: integer("blocked_at"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check(
			"telegram_users_identity_format",
			sql`typeof(${table.telegramUserId}) = 'text' AND length(${table.telegramUserId}) > 0 AND ${table.telegramUserId} NOT GLOB '*[^0-9]*'`,
		),
		check("telegram_users_display_name_nonempty", sql`length(${table.displayName}) > 0`),
		check(
			"telegram_users_blocked_at_nonnegative",
			sql`${table.blockedAt} IS NULL OR (typeof(${table.blockedAt}) = 'integer' AND ${table.blockedAt} >= 0)`,
		),
		check(
			"telegram_users_status_coherence",
			sql`(${table.status} = 'active' AND ${table.blockedAt} IS NULL) OR (${table.status} = 'blocked' AND ${table.blockedAt} IS NOT NULL)`,
		),
		check(
			"telegram_users_timestamp_coherence",
			sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} >= 0 AND typeof(${table.updatedAt}) = 'integer' AND ${table.updatedAt} >= ${table.createdAt}`,
		),
	],
);

export const profiles = sqliteTable(
	"profiles",
	{
		id: text("id").primaryKey(),
		telegramUserId: text("telegram_user_id")
			.notNull()
			.references(() => telegramUsers.telegramUserId),
		type: text("type", { enum: ["blogger", "telegram_channel", "venue_or_brand"] as const }).notNull(),
		displayName: text("display_name").notNull(),
		description: text("description"),
		cityCode: text("city_code").notNull(),
		status: text("status", { enum: ["active", "archived"] as const }).notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("profiles_one_active_per_user")
			.on(table.telegramUserId)
			.where(sql`${table.status} = 'active'`),
		index("profiles_telegram_user_status").on(table.telegramUserId, table.status),
		check("profiles_city_code", sql`${table.cityCode} = 'ekaterinburg'`),
		check("profiles_display_name_nonempty", sql`length(${table.displayName}) > 0`),
		check(
			"profiles_description_length",
			sql`${table.description} IS NULL OR (typeof(${table.description}) = 'text' AND length(${table.description}) BETWEEN 10 AND 500)`,
		),
		check("profiles_timestamp_coherence", sql`${table.updatedAt} >= ${table.createdAt}`),
	],
);

export const profilePlatforms = sqliteTable(
	"profile_platforms",
	{
		id: text("id").primaryKey(),
		profileId: text("profile_id")
			.notNull()
			.references(() => profiles.id, { onDelete: "cascade" }),
		platformType: text("platform_type", { enum: ["telegram", "instagram", "vk", "tiktok", "youtube", "website", "other"] as const }).notNull(),
		url: text("url").notNull(),
		title: text("title"),
		username: text("username"),
		telegramChatId: text("telegram_chat_id"),
		audienceSize: integer("audience_size"),
	},
	(table) => [
		index("profile_platforms_profile_id").on(table.profileId),
		check("profile_platforms_url_nonempty", sql`length(${table.url}) > 0`),
		check("profile_platforms_audience_nonnegative", sql`${table.audienceSize} IS NULL OR ${table.audienceSize} >= 0`),
	],
);

export const profileTopics = sqliteTable(
	"profile_topics",
	{
		profileId: text("profile_id")
			.notNull()
			.references(() => profiles.id, { onDelete: "cascade" }),
		topic: text("topic", { enum: ["lifestyle", "food", "beauty", "travel", "city", "events", "family", "sport", "business", "other"] as const }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.profileId, table.topic] }),
	],
);

export const profileSessions = sqliteTable(
	"profile_sessions",
	{
		telegramUserId: text("telegram_user_id")
			.primaryKey()
			.references(() => telegramUsers.telegramUserId, { onDelete: "cascade" }),
		flowType: text("flow_type", { enum: ["profile"] as const }).notNull(),
		step: text("step").notNull(),
		stateJson: text("state_json").notNull(),
		revision: integer("revision").notNull(),
		expiresAt: integer("expires_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("profile_sessions_expiry").on(table.expiresAt),
		check("profile_sessions_flow_type", sql`${table.flowType} = 'profile'`),
		check("profile_sessions_step_nonempty", sql`length(${table.step}) > 0`),
		check("profile_sessions_state_json_valid", sql`json_valid(${table.stateJson}) = 1 AND json_type(${table.stateJson}) = 'object'`),
		check("profile_sessions_revision_nonnegative", sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 0`),
		check("profile_sessions_expiry_nonnegative", sql`typeof(${table.expiresAt}) = 'integer' AND ${table.expiresAt} >= 0`),
		check("profile_sessions_updated_at_nonnegative", sql`typeof(${table.updatedAt}) = 'integer' AND ${table.updatedAt} >= 0`),
	],
);

export const collaborations = sqliteTable(
	"collaborations",
	{
		id: text("id").primaryKey(),
		publicToken: text("public_token"),
		authorProfileId: text("author_profile_id")
			.notNull()
			.references(() => profiles.id),
		format: text("format", { enum: ["advertising_integration", "barter", "joint_giveaway", "joint_content", "mutual_pr", "event", "other"] as const }),
		targetProfileType: text("target_profile_type", { enum: ["blogger", "telegram_channel", "venue_or_brand", "any"] as const }),
		title: text("title"),
		offerText: text("offer_text"),
		expectationText: text("expectation_text"),
		slotsTotal: integer("slots_total"),
		responseDeadlineAt: integer("response_deadline_at"),
		eventDateLocal: text("event_date_local"),
		cityCode: text("city_code"),
		status: text("status", { enum: ["draft", "publishing", "published", "publication_failed", "matched", "completed", "cancelled", "expired", "hidden"] as const }).notNull(),
		version: integer("version").notNull(),
		projectionRevision: integer("projection_revision").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("collaborations_one_draft_per_profile").on(table.authorProfileId).where(sql`${table.status} = 'draft'`),
		index("collaborations_author_created").on(table.authorProfileId, table.createdAt, table.id),
		check("collaborations_city_code", sql`${table.cityCode} IS NULL OR ${table.cityCode} = 'ekaterinburg'`),
		check("collaborations_version_nonnegative", sql`${table.version} >= 1`),
		check("collaborations_projection_revision_nonnegative", sql`${table.projectionRevision} >= 0`),
		check("collaborations_timestamp_coherence", sql`${table.updatedAt} >= ${table.createdAt}`),
	],
);

export const collaborationTopics = sqliteTable(
	"collaboration_topics",
	{
		collaborationId: text("collaboration_id")
			.notNull()
			.references(() => collaborations.id, { onDelete: "cascade" }),
		topic: text("topic", { enum: ["lifestyle", "food", "beauty", "travel", "city", "events", "family", "sport", "business", "other"] as const }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.collaborationId, table.topic] })],
);

export const collaborationSessions = sqliteTable(
	"collaboration_sessions",
	{
		telegramUserId: text("telegram_user_id")
			.primaryKey()
			.references(() => telegramUsers.telegramUserId, { onDelete: "cascade" }),
		collaborationId: text("collaboration_id")
			.notNull()
			.references(() => collaborations.id, { onDelete: "cascade" }),
		flowType: text("flow_type", { enum: ["collaboration"] as const }).notNull(),
		step: text("step").notNull(),
		stateJson: text("state_json").notNull(),
		revision: integer("revision").notNull(),
		expiresAt: integer("expires_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("collaboration_sessions_expiry").on(table.expiresAt),
		index("collaboration_sessions_collaboration").on(table.collaborationId),
		check("collaboration_sessions_flow_type", sql`${table.flowType} = 'collaboration'`),
		check("collaboration_sessions_state_json_valid", sql`json_valid(${table.stateJson}) = 1 AND json_type(${table.stateJson}) = 'object'`),
		check("collaboration_sessions_revision_nonnegative", sql`${table.revision} >= 0`),
	],
);

export const telegramActions = sqliteTable(
	"telegram_actions",
	{
		tokenHash: text("token_hash").primaryKey(),
		actorTelegramUserId: text("actor_telegram_user_id")
			.notNull()
			.references(() => telegramUsers.telegramUserId, { onDelete: "cascade" }),
		actionType: text("action_type").notNull(),
		entityId: text("entity_id"),
		expectedVersion: integer("expected_version"),
		mode: text("mode", { enum: ["one_shot", "reusable"] as const }).notNull(),
		expiresAt: integer("expires_at").notNull(),
		consumedAt: integer("consumed_at"),
		resultJson: text("result_json"),
	},
	(table) => [
		index("telegram_actions_actor_expiry").on(table.actorTelegramUserId, table.expiresAt),
		index("telegram_actions_expiry").on(table.expiresAt),
		check(
			"telegram_actions_token_hash_format",
			sql`typeof(${table.tokenHash}) = 'text' AND length(${table.tokenHash}) = 64 AND ${table.tokenHash} NOT GLOB '*[^0-9a-f]*'`,
		),
		check("telegram_actions_action_type_nonempty", sql`length(${table.actionType}) > 0`),
		check(
			"telegram_actions_expected_version_nonnegative",
			sql`${table.expectedVersion} IS NULL OR (typeof(${table.expectedVersion}) = 'integer' AND ${table.expectedVersion} >= 0)`,
		),
		check("telegram_actions_expiry_nonnegative", sql`typeof(${table.expiresAt}) = 'integer' AND ${table.expiresAt} >= 0`),
		check(
			"telegram_actions_consumed_at_nonnegative",
			sql`${table.consumedAt} IS NULL OR (typeof(${table.consumedAt}) = 'integer' AND ${table.consumedAt} >= 0)`,
		),
		check("telegram_actions_result_json_valid", sql`${table.resultJson} IS NULL OR json_valid(${table.resultJson}) = 1`),
		check(
			"telegram_actions_consumed_result",
			sql`${table.consumedAt} IS NULL OR ${table.resultJson} IS NOT NULL`,
		),
		check(
			"telegram_actions_reusable_not_consumed",
			sql`${table.mode} = 'one_shot' OR ${table.consumedAt} IS NULL`,
		),
	],
);

export const commandReceipts = sqliteTable(
	"command_receipts",
	{
		commandId: text("command_id").primaryKey(),
		source: text("source", { enum: ["telegram", "operator", "runner"] as const }).notNull(),
		telegramUpdateId: integer("telegram_update_id"),
		inputHash: text("input_hash").notNull(),
		status: text("status", { enum: ["in_progress", "completed"] as const }).notNull(),
		resultJson: text("result_json"),
		createdAt: integer("created_at").notNull(),
		completedAt: integer("completed_at"),
	},
	(table) => [
		index("command_receipts_status_created").on(table.status, table.createdAt),
		uniqueIndex("command_receipts_telegram_update")
			.on(table.telegramUpdateId)
			.where(sql`${table.telegramUpdateId} IS NOT NULL`),
		check("command_receipts_command_id_nonempty", sql`length(${table.commandId}) > 0`),
		check(
			"command_receipts_update_id_nonnegative",
			sql`${table.telegramUpdateId} IS NULL OR (typeof(${table.telegramUpdateId}) = 'integer' AND ${table.telegramUpdateId} >= 0)`,
		),
		check(
			"command_receipts_input_hash_format",
			sql`typeof(${table.inputHash}) = 'text' AND length(${table.inputHash}) = 64 AND ${table.inputHash} NOT GLOB '*[^0-9a-f]*'`,
		),
		check(
			"command_receipts_source_update_coherence",
			sql`(${table.source} = 'telegram' AND ${table.telegramUpdateId} IS NOT NULL) OR (${table.source} IN ('operator', 'runner') AND ${table.telegramUpdateId} IS NULL)`,
		),
		check(
			"command_receipts_result_state_coherence",
			sql`(${table.status} = 'in_progress' AND ${table.resultJson} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'completed' AND ${table.resultJson} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
		),
		check("command_receipts_result_json_valid", sql`${table.resultJson} IS NULL OR json_valid(${table.resultJson}) = 1`),
		check(
			"command_receipts_completed_at_coherence",
			sql`${table.createdAt} >= 0 AND (${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.createdAt})`,
		),
	],
);

export const processedUpdates = sqliteTable(
	"processed_updates",
	{
		updateId: integer("update_id").primaryKey(),
		commandId: text("command_id")
			.notNull()
			.references(() => commandReceipts.commandId, { onDelete: "cascade" }),
		processedAt: integer("processed_at").notNull(),
	},
	(table) => [
		uniqueIndex("processed_updates_command_id").on(table.commandId),
		index("processed_updates_processed_at").on(table.processedAt),
		check("processed_updates_update_id_nonnegative", sql`typeof(${table.updateId}) = 'integer' AND ${table.updateId} >= 0`),
		check("processed_updates_processed_at_nonnegative", sql`typeof(${table.processedAt}) = 'integer' AND ${table.processedAt} >= 0`),
	],
);

export const outboxDeliveries = sqliteTable(
	"outbox_deliveries",
	{
		id: text("id").primaryKey(),
		idempotencyKey: text("idempotency_key").notNull(),
		kind: text("kind", { enum: ["dm_send", "channel_send", "channel_edit", "channel_delete"] as const }).notNull(),
		recipientChatId: text("recipient_chat_id").notNull(),
		messageId: integer("message_id"),
		payloadJson: text("payload_json").notNull(),
		status: text("status", { enum: [
			"prepared", "dispatching", "sent", "retryable_failed", "ambiguous", "permanent_failed", "superseded", "cancelled",
		] as const }).notNull(),
		attemptCount: integer("attempt_count").notNull(),
		claimToken: text("claim_token"),
		dispatchStartedAt: integer("dispatch_started_at"),
		requestDeadlineAt: integer("request_deadline_at"),
		nextAttemptAt: integer("next_attempt_at"),
		telegramRetryAfter: integer("telegram_retry_after"),
		lastErrorKind: text("last_error_kind"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("outbox_deliveries_idempotency_key").on(table.idempotencyKey),
		index("outbox_deliveries_due").on(table.status, table.nextAttemptAt, table.createdAt),
		index("outbox_deliveries_dispatching").on(table.status, table.dispatchStartedAt),
		index("outbox_deliveries_recipient").on(table.recipientChatId, table.status),
		check("outbox_deliveries_attempt_nonnegative", sql`typeof(${table.attemptCount}) = 'integer' AND ${table.attemptCount} >= 0`),
		check("outbox_deliveries_payload_json_valid", sql`json_valid(${table.payloadJson}) = 1`),
		check("outbox_deliveries_updated_at_coherence", sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} >= 0 AND typeof(${table.updatedAt}) = 'integer' AND ${table.updatedAt} >= ${table.createdAt}`),
	],
);

export const channelPublications = sqliteTable(
	"channel_publications",
	{
		collaborationId: text("collaboration_id").primaryKey().references(() => collaborations.id, { onDelete: "cascade" }),
		channelChatId: text("channel_chat_id").notNull(),
		messageId: integer("message_id"),
		status: text("status", { enum: ["prepared", "sending", "published", "failed"] as const }).notNull(),
		renderedTermsVersion: integer("rendered_terms_version").notNull(),
		renderedProjectionRevision: integer("rendered_projection_revision").notNull(),
		renderedHash: text("rendered_hash").notNull(),
		currentAttemptNo: integer("current_attempt_no").notNull(),
		lastDeliveryId: text("last_delivery_id").references(() => outboxDeliveries.id),
		lastErrorKind: text("last_error_kind"),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [index("channel_publications_status").on(table.status, table.updatedAt)],
);

export const productEvents = sqliteTable(
	"product_events",
	{
		eventId: text("event_id").primaryKey(),
		eventType: text("event_type", { enum: [
			"bot_started", "profile_started", "profile_completed", "collaboration_draft_started", "collaboration_published",
			"collaboration_viewed", "application_submitted", "application_accepted", "collaboration_matched",
			"completion_reported", "collaboration_bilateral_confirmed", "collaboration_hidden", "user_blocked",
		] as const }).notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		actorTelegramUserId: text("actor_telegram_user_id"),
		profileId: text("profile_id"),
		collaborationId: text("collaboration_id"),
		applicationId: text("application_id"),
		safeAttributesJson: text("safe_attributes_json").notNull(),
		occurredAt: integer("occurred_at").notNull(),
	},
	(table) => [
		uniqueIndex("product_events_idempotency_key").on(table.idempotencyKey),
		index("product_events_type_occurred").on(table.eventType, table.occurredAt),
		index("product_events_actor_occurred").on(table.actorTelegramUserId, table.occurredAt),
		check("product_events_safe_attributes_json_valid", sql`json_valid(${table.safeAttributesJson}) = 1 AND json_type(${table.safeAttributesJson}) = 'object'`),
	],
);
