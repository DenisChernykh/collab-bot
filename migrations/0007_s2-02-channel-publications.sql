CREATE TABLE channel_publications (
	collaboration_id TEXT PRIMARY KEY REFERENCES collaborations(id) ON DELETE CASCADE,
	channel_chat_id TEXT NOT NULL,
	message_id INTEGER,
	status TEXT NOT NULL CHECK(status IN ('prepared', 'sending', 'published', 'failed')),
	rendered_terms_version INTEGER NOT NULL CHECK(typeof(rendered_terms_version) = 'integer' AND rendered_terms_version >= 1),
	rendered_projection_revision INTEGER NOT NULL CHECK(typeof(rendered_projection_revision) = 'integer' AND rendered_projection_revision >= 0),
	rendered_hash TEXT NOT NULL CHECK(length(rendered_hash) = 64 AND rendered_hash NOT GLOB '*[^0-9a-f]*'),
	current_attempt_no INTEGER NOT NULL CHECK(typeof(current_attempt_no) = 'integer' AND current_attempt_no >= 1),
	last_delivery_id TEXT REFERENCES outbox_deliveries(id),
	last_error_kind TEXT,
	updated_at INTEGER NOT NULL,
	CHECK(length(channel_chat_id) > 0),
	CHECK(message_id IS NULL OR (typeof(message_id) = 'integer' AND message_id > 0)),
	CHECK((status IN ('prepared', 'sending') AND message_id IS NULL) OR status IN ('published', 'failed') ),
	CHECK(last_error_kind IS NULL OR last_error_kind IN ('rate_limited', 'forbidden', 'invalid_chat', 'not_found', 'network', 'provider_timeout', 'unknown')),
	CHECK(typeof(updated_at) = 'integer' AND updated_at >= 0)
);

CREATE INDEX channel_publications_status ON channel_publications(status, updated_at);
