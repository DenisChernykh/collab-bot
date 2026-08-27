CREATE TABLE _s4_hidden_migration_guard (
	hidden_count INTEGER NOT NULL
		CONSTRAINT s4_hidden_rows_require_manual_resolution CHECK (hidden_count = 0)
);

INSERT INTO _s4_hidden_migration_guard (hidden_count)
SELECT count(*) FROM collaborations WHERE status = 'hidden';

DROP TABLE _s4_hidden_migration_guard;

ALTER TABLE collaborations ADD COLUMN hidden_from_status TEXT NULL
	CHECK (
		hidden_from_status IS NULL
		OR hidden_from_status IN ('published', 'matched', 'completed', 'cancelled', 'expired')
	);

ALTER TABLE collaborations ADD COLUMN hidden_at INTEGER NULL
	CHECK (
		hidden_at IS NULL
		OR (typeof(hidden_at) = 'integer' AND hidden_at >= 0)
	);

CREATE TRIGGER collaborations_hidden_overlay_insert_guard
BEFORE INSERT ON collaborations
FOR EACH ROW
WHEN (
	NEW.status = 'hidden'
	AND (
		NEW.hidden_from_status IS NULL
		OR NEW.hidden_at IS NULL
		OR NEW.hidden_at < NEW.created_at
		OR NEW.hidden_at > NEW.updated_at
	)
) OR (
	NEW.status <> 'hidden'
	AND (NEW.hidden_from_status IS NOT NULL OR NEW.hidden_at IS NOT NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'collaboration hidden overlay is incoherent');
END;

CREATE TRIGGER collaborations_hidden_overlay_update_guard
BEFORE UPDATE OF status, hidden_from_status, hidden_at, created_at, updated_at ON collaborations
FOR EACH ROW
WHEN (
	NEW.status = 'hidden'
	AND (
		NEW.hidden_from_status IS NULL
		OR NEW.hidden_at IS NULL
		OR NEW.hidden_at < NEW.created_at
		OR NEW.hidden_at > NEW.updated_at
		OR (OLD.status <> 'hidden' AND NEW.hidden_from_status IS NOT OLD.status)
		OR (OLD.status = 'hidden' AND NEW.hidden_from_status IS NOT OLD.hidden_from_status)
		OR (OLD.status = 'hidden' AND NEW.hidden_at IS NOT OLD.hidden_at)
	)
) OR (
	NEW.status <> 'hidden'
	AND (NEW.hidden_from_status IS NOT NULL OR NEW.hidden_at IS NOT NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'collaboration hidden overlay is incoherent');
END;

CREATE TABLE operator_actions (
	id TEXT PRIMARY KEY NOT NULL CHECK (
		typeof(id) = 'text'
		AND length(id) = 36
		AND id NOT GLOB '*[^0-9A-Fa-f-]*'
		AND substr(id, 9, 1) = '-'
		AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-'
		AND substr(id, 24, 1) = '-'
		AND length(replace(id, '-', '')) = 32
	),
	actor_kind TEXT NOT NULL CHECK (actor_kind = 'admin'),
	actor_telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id),
	collaboration_id TEXT NOT NULL REFERENCES collaborations(id),
	action_type TEXT NOT NULL CHECK (action_type = 'hide_collaboration'),
	reason TEXT NOT NULL CHECK (
		typeof(reason) = 'text'
		AND reason = trim(reason)
		AND length(reason) BETWEEN 1 AND 500
		AND instr(reason, char(0)) = 0
	),
	before_state_json TEXT NOT NULL CHECK (
		json_valid(before_state_json) = 1
		AND json_type(before_state_json) = 'object'
		AND json_type(before_state_json, '$.status') = 'text'
		AND json_extract(before_state_json, '$.status') IN ('published', 'matched', 'completed', 'cancelled', 'expired')
		AND json_type(before_state_json, '$.projectionRevision') = 'integer'
		AND json_extract(before_state_json, '$.projectionRevision') >= 0
		AND json_remove(json_remove(json(before_state_json), '$.status'), '$.projectionRevision') = '{}'
	),
	after_state_json TEXT NOT NULL CHECK (
		json_valid(after_state_json) = 1
		AND json_type(after_state_json) = 'object'
		AND json_extract(after_state_json, '$.status') = 'hidden'
		AND json_type(after_state_json, '$.projectionRevision') = 'integer'
		AND json_extract(after_state_json, '$.projectionRevision') = json_extract(before_state_json, '$.projectionRevision') + 1
		AND json_remove(json_remove(json(after_state_json), '$.status'), '$.projectionRevision') = '{}'
	),
	command_id TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL CHECK (
		typeof(created_at) = 'integer' AND created_at >= 0
	)
);

CREATE INDEX operator_actions_collaboration_created
	ON operator_actions (collaboration_id, created_at DESC, id DESC);

CREATE INDEX operator_actions_actor_created
	ON operator_actions (actor_telegram_user_id, created_at DESC, id DESC);

CREATE TRIGGER operator_actions_append_only_update
BEFORE UPDATE ON operator_actions
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'operator actions are append-only');
END;

CREATE TRIGGER operator_actions_append_only_delete
BEFORE DELETE ON operator_actions
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'operator actions are append-only');
END;
