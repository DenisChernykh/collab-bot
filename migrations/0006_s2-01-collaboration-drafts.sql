CREATE TABLE collaborations (
	id TEXT PRIMARY KEY NOT NULL CHECK (
		typeof(id) = 'text' AND length(id) = 36 AND id NOT GLOB '*[^0-9A-Fa-f-]*'
		AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
		AND length(replace(id, '-', '')) = 32
	),
	public_token TEXT NULL UNIQUE CHECK (
		public_token IS NULL OR (
			typeof(public_token) = 'text' AND length(public_token) BETWEEN 16 AND 32
			AND public_token NOT GLOB '*[^A-Za-z0-9_-]*'
		)
	),
	author_profile_id TEXT NOT NULL REFERENCES profiles(id),
	format TEXT NULL CHECK (format IS NULL OR format IN ('advertising_integration', 'barter', 'joint_giveaway', 'joint_content', 'mutual_pr', 'event', 'other')),
	target_profile_type TEXT NULL CHECK (target_profile_type IS NULL OR target_profile_type IN ('blogger', 'telegram_channel', 'venue_or_brand', 'any')),
	title TEXT NULL CHECK (title IS NULL OR length(title) BETWEEN 5 AND 100),
	offer_text TEXT NULL CHECK (offer_text IS NULL OR length(offer_text) BETWEEN 10 AND 1000),
	expectation_text TEXT NULL CHECK (expectation_text IS NULL OR length(expectation_text) BETWEEN 10 AND 1000),
	slots_total INTEGER NULL CHECK (slots_total IS NULL OR (typeof(slots_total) = 'integer' AND slots_total BETWEEN 1 AND 10)),
	response_deadline_at INTEGER NULL CHECK (response_deadline_at IS NULL OR (typeof(response_deadline_at) = 'integer' AND response_deadline_at >= 0)),
	event_date_local TEXT NULL CHECK (event_date_local IS NULL OR (typeof(event_date_local) = 'text' AND event_date_local GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
	city_code TEXT NULL CHECK (city_code IS NULL OR city_code = 'ekaterinburg'),
	status TEXT NOT NULL CHECK (status IN ('draft', 'publishing', 'published', 'publication_failed', 'matched', 'completed', 'cancelled', 'expired', 'hidden')),
	version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
	projection_revision INTEGER NOT NULL CHECK (typeof(projection_revision) = 'integer' AND projection_revision >= 0),
	created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
	CHECK (
		status = 'draft'
		OR (public_token IS NOT NULL AND format IS NOT NULL AND target_profile_type IS NOT NULL
			AND title IS NOT NULL AND offer_text IS NOT NULL AND expectation_text IS NOT NULL
			AND slots_total IS NOT NULL AND response_deadline_at IS NOT NULL AND city_code = 'ekaterinburg')
	),
	CHECK (status = 'draft' OR public_token IS NOT NULL)
);

CREATE UNIQUE INDEX collaborations_one_draft_per_profile
	ON collaborations (author_profile_id)
	WHERE status = 'draft';

CREATE INDEX collaborations_author_created
	ON collaborations (author_profile_id, created_at DESC, id DESC);

CREATE TABLE collaboration_topics (
	collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
	topic TEXT NOT NULL CHECK (topic IN ('lifestyle', 'food', 'beauty', 'travel', 'city', 'events', 'family', 'sport', 'business', 'other')),
	PRIMARY KEY (collaboration_id, topic)
);

CREATE TABLE collaboration_sessions (
	telegram_user_id TEXT PRIMARY KEY REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
	collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
	flow_type TEXT NOT NULL CHECK (flow_type = 'collaboration'),
	step TEXT NOT NULL CHECK (length(step) > 0),
	state_json TEXT NOT NULL CHECK (json_valid(state_json) = 1 AND json_type(state_json) = 'object'),
	revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 0),
	expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer' AND expires_at >= 0),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0)
);

CREATE INDEX collaboration_sessions_expiry ON collaboration_sessions (expires_at);
CREATE INDEX collaboration_sessions_collaboration ON collaboration_sessions (collaboration_id);

CREATE TRIGGER collaboration_sessions_owner_guard_insert
BEFORE INSERT ON collaboration_sessions
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM collaborations c
	JOIN profiles p ON p.id = c.author_profile_id AND p.status = 'active'
	WHERE c.id = NEW.collaboration_id
	  AND p.telegram_user_id = NEW.telegram_user_id
	  AND c.status = 'draft'
)
BEGIN
	SELECT RAISE(ABORT, 'collaboration session must belong to the active author draft');
END;

CREATE TRIGGER collaboration_sessions_owner_guard_update
BEFORE UPDATE OF telegram_user_id, collaboration_id ON collaboration_sessions
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM collaborations c
	JOIN profiles p ON p.id = c.author_profile_id AND p.status = 'active'
	WHERE c.id = NEW.collaboration_id
	  AND p.telegram_user_id = NEW.telegram_user_id
	  AND c.status = 'draft'
)
BEGIN
	SELECT RAISE(ABORT, 'collaboration session must belong to the active author draft');
END;
