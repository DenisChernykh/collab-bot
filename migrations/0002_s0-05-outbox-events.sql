CREATE TABLE outbox_deliveries (
	id TEXT PRIMARY KEY NOT NULL CHECK (
		typeof(id) = 'text' AND length(id) = 36 AND id NOT GLOB '*[^0-9A-Fa-f-]*'
		AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
		AND substr(id, 1, 8) NOT GLOB '*[^0-9A-Fa-f]*' AND substr(id, 10, 4) NOT GLOB '*[^0-9A-Fa-f]*'
		AND substr(id, 15, 4) NOT GLOB '*[^0-9A-Fa-f]*' AND substr(id, 20, 4) NOT GLOB '*[^0-9A-Fa-f]*'
		AND substr(id, 25, 12) NOT GLOB '*[^0-9A-Fa-f]*'
		AND length(replace(id, '-', '')) = 32
	),
	idempotency_key TEXT NOT NULL UNIQUE CHECK (
		typeof(idempotency_key) = 'text' AND length(idempotency_key) BETWEEN 1 AND 128
		AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
	),
	kind TEXT NOT NULL CHECK (kind IN ('dm_send', 'channel_send', 'channel_edit', 'channel_delete')),
	recipient_chat_id TEXT NOT NULL CHECK (
		typeof(recipient_chat_id) = 'text' AND length(recipient_chat_id) BETWEEN 1 AND 20
		AND (
			(recipient_chat_id GLOB '[0-9]*' AND recipient_chat_id NOT GLOB '*[^0-9]*')
			OR (
				recipient_chat_id GLOB '-[0-9]*'
				AND substr(recipient_chat_id, 2) NOT GLOB '*[^0-9]*'
			)
		)
	),
	message_id INTEGER NULL CHECK (message_id IS NULL OR (typeof(message_id) = 'integer' AND message_id > 0)),
	payload_json TEXT NOT NULL CHECK (typeof(payload_json) = 'text' AND json_valid(payload_json) = 1),
	status TEXT NOT NULL CHECK (status IN (
		'prepared', 'dispatching', 'sent', 'retryable_failed', 'ambiguous',
		'permanent_failed', 'superseded', 'cancelled'
	)),
	attempt_count INTEGER NOT NULL CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
	claim_token TEXT NULL CHECK (
		claim_token IS NULL OR (
			typeof(claim_token) = 'text' AND length(claim_token) BETWEEN 1 AND 128
			AND claim_token NOT GLOB '*[^A-Za-z0-9._:-]*'
		)
	),
	dispatch_started_at INTEGER NULL CHECK (dispatch_started_at IS NULL OR (typeof(dispatch_started_at) = 'integer' AND dispatch_started_at >= 0)),
	request_deadline_at INTEGER NULL CHECK (request_deadline_at IS NULL OR (typeof(request_deadline_at) = 'integer' AND request_deadline_at >= 0)),
	next_attempt_at INTEGER NULL CHECK (next_attempt_at IS NULL OR (typeof(next_attempt_at) = 'integer' AND next_attempt_at >= 0)),
	telegram_retry_after INTEGER NULL CHECK (telegram_retry_after IS NULL OR (typeof(telegram_retry_after) = 'integer' AND telegram_retry_after >= 0)),
	last_error_kind TEXT NULL CHECK (
		last_error_kind IS NULL OR (
			typeof(last_error_kind) = 'text' AND length(last_error_kind) BETWEEN 1 AND 64
			AND last_error_kind NOT GLOB '*[^a-z0-9._-]*'
		)
	),
	created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
	CHECK (kind IN ('channel_edit', 'channel_delete') OR message_id IS NULL OR message_id > 0),
	CHECK (kind NOT IN ('channel_edit', 'channel_delete') OR message_id IS NOT NULL),
	CHECK (status <> 'sent' OR message_id IS NOT NULL),
	CHECK (status NOT IN ('sent', 'permanent_failed') OR attempt_count > 0),
	CHECK (status <> 'sent' OR (next_attempt_at IS NULL AND telegram_retry_after IS NULL AND last_error_kind IS NULL)),
	CHECK (status <> 'permanent_failed' OR (last_error_kind IS NOT NULL AND next_attempt_at IS NULL AND telegram_retry_after IS NULL)),
	CHECK (next_attempt_at IS NULL OR status IN ('prepared', 'retryable_failed')),
	CHECK (telegram_retry_after IS NULL OR status = 'retryable_failed'),
	CHECK (last_error_kind IS NULL OR status IN ('retryable_failed', 'ambiguous', 'permanent_failed')),
	CHECK (
		status <> 'dispatching'
		OR (attempt_count > 0 AND claim_token IS NOT NULL AND dispatch_started_at IS NOT NULL AND request_deadline_at IS NOT NULL)
	),
	CHECK (
		status = 'dispatching'
		OR (claim_token IS NULL AND dispatch_started_at IS NULL AND request_deadline_at IS NULL)
	),
	CHECK (
		status <> 'retryable_failed'
		OR (attempt_count > 0 AND next_attempt_at IS NOT NULL AND last_error_kind IS NOT NULL)
	),
	CHECK (
		status <> 'ambiguous'
		OR (attempt_count > 0 AND next_attempt_at IS NULL AND last_error_kind IS NOT NULL)
	),
	CHECK (
		status <> 'prepared'
		OR (attempt_count = 0 AND claim_token IS NULL AND dispatch_started_at IS NULL AND request_deadline_at IS NULL
			AND (next_attempt_at IS NULL OR next_attempt_at >= created_at) AND telegram_retry_after IS NULL AND last_error_kind IS NULL
			AND (kind IN ('channel_edit', 'channel_delete') OR message_id IS NULL))
	),
	CHECK (
		status <> 'cancelled'
		OR (attempt_count = 0 AND claim_token IS NULL AND dispatch_started_at IS NULL AND request_deadline_at IS NULL
			AND next_attempt_at IS NULL AND telegram_retry_after IS NULL AND last_error_kind IS NULL
			AND (kind IN ('channel_edit', 'channel_delete') OR message_id IS NULL))
	),
	CHECK (
		json_extract(payload_json, '$.version') = 1
		AND (
			(kind IN ('dm_send', 'channel_send') AND json_extract(payload_json, '$.method') = 'send' AND json_type(payload_json, '$.text') = 'text')
			OR (kind = 'channel_edit' AND json_extract(payload_json, '$.method') = 'edit' AND json_type(payload_json, '$.text') = 'text')
			OR (kind = 'channel_delete' AND json_extract(payload_json, '$.method') = 'delete' AND json_type(payload_json, '$.text') IS NULL)
		)
	)
);

CREATE INDEX outbox_deliveries_due
	ON outbox_deliveries (status, next_attempt_at, created_at);

CREATE INDEX outbox_deliveries_dispatching
	ON outbox_deliveries (status, dispatch_started_at);

CREATE INDEX outbox_deliveries_recipient
	ON outbox_deliveries (recipient_chat_id, status);

CREATE TABLE product_events (
	event_id TEXT PRIMARY KEY NOT NULL CHECK (
		typeof(event_id) = 'text' AND length(event_id) = 36 AND event_id NOT GLOB '*[^0-9A-Fa-f-]*'
		AND substr(event_id, 9, 1) = '-' AND substr(event_id, 14, 1) = '-'
		AND substr(event_id, 19, 1) = '-' AND substr(event_id, 24, 1) = '-'
		AND substr(event_id, 1, 8) NOT GLOB '*[^0-9A-Fa-f]*' AND substr(event_id, 10, 4) NOT GLOB '*[^0-9A-Fa-f]*'
		AND substr(event_id, 15, 4) NOT GLOB '*[^0-9A-Fa-f]*' AND substr(event_id, 20, 4) NOT GLOB '*[^0-9A-Fa-f]*'
		AND substr(event_id, 25, 12) NOT GLOB '*[^0-9A-Fa-f]*'
		AND length(replace(event_id, '-', '')) = 32
	),
	event_type TEXT NOT NULL CHECK (event_type IN (
		'bot_started', 'profile_started', 'profile_completed', 'collaboration_draft_started',
		'collaboration_published', 'collaboration_viewed', 'application_submitted',
		'application_accepted', 'collaboration_matched', 'completion_reported',
		'collaboration_bilateral_confirmed', 'collaboration_hidden', 'user_blocked'
	)),
	idempotency_key TEXT NOT NULL UNIQUE CHECK (
		typeof(idempotency_key) = 'text' AND length(idempotency_key) BETWEEN 1 AND 128
		AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
	),
	actor_telegram_user_id TEXT NULL CHECK (
		actor_telegram_user_id IS NULL OR (
			typeof(actor_telegram_user_id) = 'text' AND length(actor_telegram_user_id) BETWEEN 1 AND 20
			AND actor_telegram_user_id NOT GLOB '*[^0-9]*'
		)
	),
	profile_id TEXT NULL CHECK (profile_id IS NULL OR (typeof(profile_id) = 'text' AND length(profile_id) BETWEEN 1 AND 128 AND profile_id NOT GLOB '*[^A-Za-z0-9._:-]*')),
	collaboration_id TEXT NULL CHECK (collaboration_id IS NULL OR (typeof(collaboration_id) = 'text' AND length(collaboration_id) BETWEEN 1 AND 128 AND collaboration_id NOT GLOB '*[^A-Za-z0-9._:-]*')),
	application_id TEXT NULL CHECK (application_id IS NULL OR (typeof(application_id) = 'text' AND length(application_id) BETWEEN 1 AND 128 AND application_id NOT GLOB '*[^A-Za-z0-9._:-]*')),
	safe_attributes_json TEXT NOT NULL CHECK (typeof(safe_attributes_json) = 'text' AND json_valid(safe_attributes_json) = 1 AND json_type(safe_attributes_json) = 'object'),
	occurred_at INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer' AND occurred_at >= 0)
);

CREATE INDEX product_events_type_occurred
	ON product_events (event_type, occurred_at);

CREATE INDEX product_events_actor_occurred
	ON product_events (actor_telegram_user_id, occurred_at);

CREATE TRIGGER product_events_append_only_update
BEFORE UPDATE ON product_events
BEGIN
	SELECT RAISE(ABORT, 'product_events is append-only');
END;

CREATE TRIGGER product_events_append_only_delete
BEFORE DELETE ON product_events
BEGIN
	SELECT RAISE(ABORT, 'product_events is append-only');
END;
