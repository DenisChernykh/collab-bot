ALTER TABLE collaborations ADD COLUMN published_at INTEGER NULL
	CHECK (published_at IS NULL OR (typeof(published_at) = 'integer' AND published_at >= 0));

UPDATE collaborations
SET published_at = (
	SELECT publication.updated_at
	FROM channel_publications publication
	WHERE publication.collaboration_id = collaborations.id
	  AND publication.status = 'published'
	  AND publication.message_id IS NOT NULL
)
WHERE EXISTS (
	SELECT 1
	FROM channel_publications publication
	WHERE publication.collaboration_id = collaborations.id
	  AND publication.status = 'published'
	  AND publication.message_id IS NOT NULL
  );

CREATE INDEX collaborations_feed_order
	ON collaborations (status, published_at DESC, id DESC);

CREATE TRIGGER collaborations_published_at_immutable
BEFORE UPDATE OF published_at ON collaborations
FOR EACH ROW
WHEN OLD.published_at IS NOT NULL AND NEW.published_at IS NOT OLD.published_at
BEGIN
	SELECT RAISE(ABORT, 'collaboration published_at is immutable');
END;

CREATE TABLE browse_sessions (
	telegram_user_id TEXT PRIMARY KEY REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
	generation TEXT NOT NULL CHECK (
		typeof(generation) = 'text'
		AND length(generation) = 16
		AND generation NOT GLOB '*[^0-9a-f]*'
	),
	target_profile_type_filter TEXT NULL CHECK (
		target_profile_type_filter IS NULL
		OR target_profile_type_filter IN ('blogger', 'telegram_channel', 'venue_or_brand')
	),
	format_filter TEXT NULL CHECK (
		format_filter IS NULL
		OR format_filter IN ('advertising_integration', 'barter', 'joint_giveaway', 'joint_content', 'mutual_pr', 'event', 'other')
	),
	topic_filter TEXT NULL CHECK (
		topic_filter IS NULL
		OR topic_filter IN ('lifestyle', 'food', 'beauty', 'travel', 'city', 'events', 'family', 'sport', 'business', 'other')
	),
	cursor_published_at INTEGER NULL CHECK (
		cursor_published_at IS NULL
		OR (typeof(cursor_published_at) = 'integer' AND cursor_published_at >= 0)
	),
	cursor_collaboration_id TEXT NULL CHECK (
		cursor_collaboration_id IS NULL
		OR (
			typeof(cursor_collaboration_id) = 'text'
			AND length(cursor_collaboration_id) = 36
			AND cursor_collaboration_id NOT GLOB '*[^0-9A-Fa-f-]*'
			AND substr(cursor_collaboration_id, 9, 1) = '-'
			AND substr(cursor_collaboration_id, 14, 1) = '-'
			AND substr(cursor_collaboration_id, 19, 1) = '-'
			AND substr(cursor_collaboration_id, 24, 1) = '-'
			AND length(replace(cursor_collaboration_id, '-', '')) = 32
		)
	),
	revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 0),
	expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer' AND expires_at >= 0),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0),
	CHECK (
		(cursor_published_at IS NULL AND cursor_collaboration_id IS NULL)
		OR (cursor_published_at IS NOT NULL AND cursor_collaboration_id IS NOT NULL)
	),
	CHECK (expires_at >= updated_at)
);

CREATE INDEX browse_sessions_expiry ON browse_sessions (expires_at);
