CREATE TABLE profile_sessions (
	telegram_user_id TEXT PRIMARY KEY REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
	flow_type TEXT NOT NULL,
	step TEXT NOT NULL,
	state_json TEXT NOT NULL,
	revision INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	CHECK (flow_type = 'profile'),
	CHECK (length(step) > 0),
	CHECK (json_valid(state_json) = 1 AND json_type(state_json) = 'object'),
	CHECK (typeof(revision) = 'integer' AND revision >= 0),
	CHECK (typeof(expires_at) = 'integer' AND expires_at >= 0),
	CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0)
);

CREATE INDEX profile_sessions_expiry ON profile_sessions (expires_at);
