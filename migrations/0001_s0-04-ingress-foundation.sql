CREATE TABLE telegram_users (
	telegram_user_id TEXT PRIMARY KEY NOT NULL
		CHECK (typeof(telegram_user_id) = 'text' AND length(telegram_user_id) > 0 AND telegram_user_id NOT GLOB '*[^0-9]*'),
	username TEXT NULL,
	display_name TEXT NOT NULL CHECK (length(display_name) > 0),
	status TEXT NOT NULL CHECK (status IN ('active', 'blocked')),
	blocked_at INTEGER NULL CHECK (blocked_at IS NULL OR (typeof(blocked_at) = 'integer' AND blocked_at >= 0)),
	created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0),
	CHECK (
		(status = 'active' AND blocked_at IS NULL)
		OR (status = 'blocked' AND blocked_at IS NOT NULL)
	),
	CHECK (updated_at >= created_at)
);

CREATE TABLE telegram_actions (
	token_hash TEXT PRIMARY KEY NOT NULL
		CHECK (typeof(token_hash) = 'text' AND length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
	actor_telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
	action_type TEXT NOT NULL CHECK (typeof(action_type) = 'text' AND length(action_type) > 0),
	entity_id TEXT NULL,
	expected_version INTEGER NULL CHECK (expected_version IS NULL OR (typeof(expected_version) = 'integer' AND expected_version >= 0)),
	mode TEXT NOT NULL CHECK (mode IN ('one_shot', 'reusable')),
	expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer' AND expires_at >= 0),
	consumed_at INTEGER NULL CHECK (consumed_at IS NULL OR (typeof(consumed_at) = 'integer' AND consumed_at >= 0)),
	result_json TEXT NULL CHECK (result_json IS NULL OR json_valid(result_json) = 1),
	CHECK (mode = 'one_shot' OR consumed_at IS NULL),
	CHECK (consumed_at IS NULL OR result_json IS NOT NULL)
);

CREATE TABLE command_receipts (
	command_id TEXT PRIMARY KEY NOT NULL CHECK (typeof(command_id) = 'text' AND length(command_id) > 0),
	source TEXT NOT NULL CHECK (source IN ('telegram', 'operator', 'runner')),
	telegram_update_id INTEGER NULL CHECK (telegram_update_id IS NULL OR (typeof(telegram_update_id) = 'integer' AND telegram_update_id >= 0)),
	input_hash TEXT NOT NULL
		CHECK (typeof(input_hash) = 'text' AND length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
	status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
	result_json TEXT NULL CHECK (result_json IS NULL OR json_valid(result_json) = 1),
	created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
	completed_at INTEGER NULL CHECK (completed_at IS NULL OR (typeof(completed_at) = 'integer' AND completed_at >= 0)),
	CHECK (
		(source = 'telegram' AND telegram_update_id IS NOT NULL)
		OR (source IN ('operator', 'runner') AND telegram_update_id IS NULL)
	),
	CHECK (
		(status = 'in_progress' AND result_json IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND result_json IS NOT NULL AND completed_at IS NOT NULL)
	),
	CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE TABLE processed_updates (
	update_id INTEGER PRIMARY KEY CHECK (typeof(update_id) = 'integer' AND update_id >= 0),
	command_id TEXT NOT NULL REFERENCES command_receipts(command_id) ON DELETE CASCADE,
	processed_at INTEGER NOT NULL CHECK (typeof(processed_at) = 'integer' AND processed_at >= 0)
);

CREATE TRIGGER processed_updates_receipt_coherence_insert
BEFORE INSERT ON processed_updates
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1
	FROM command_receipts
	WHERE command_id = NEW.command_id
	  AND source = 'telegram'
	  AND telegram_update_id = NEW.update_id
)
BEGIN
	SELECT RAISE(ABORT, 'processed update must reference matching telegram receipt');
END;

CREATE TRIGGER processed_updates_receipt_coherence_update
BEFORE UPDATE OF update_id, command_id ON processed_updates
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1
	FROM command_receipts
	WHERE command_id = NEW.command_id
	  AND source = 'telegram'
	  AND telegram_update_id = NEW.update_id
)
BEGIN
	SELECT RAISE(ABORT, 'processed update must reference matching telegram receipt');
END;

CREATE INDEX telegram_actions_actor_expiry
	ON telegram_actions (actor_telegram_user_id, expires_at);

CREATE INDEX telegram_actions_expiry
	ON telegram_actions (expires_at);

CREATE INDEX command_receipts_status_created
	ON command_receipts (status, created_at);

CREATE UNIQUE INDEX command_receipts_telegram_update
	ON command_receipts (telegram_update_id)
	WHERE telegram_update_id IS NOT NULL;

CREATE INDEX processed_updates_processed_at
	ON processed_updates (processed_at);

CREATE UNIQUE INDEX processed_updates_command_id
	ON processed_updates (command_id);
