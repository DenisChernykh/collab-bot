import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
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
