CREATE TABLE mfm_discovery_settings (
	profile_id TEXT PRIMARY KEY NOT NULL REFERENCES mfm_profiles(profile_id) ON DELETE CASCADE,
	visible INTEGER NOT NULL DEFAULT 0 CHECK (visible IN (0, 1)),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);
CREATE INDEX mfm_discovery_visible ON mfm_discovery_settings(visible, profile_id);

CREATE TABLE introduction_requests (
	id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
	public_token TEXT NOT NULL UNIQUE CHECK (length(public_token) = 22 AND public_token NOT GLOB '*[^A-Za-z0-9_-]*'),
	sender_profile_id TEXT NOT NULL REFERENCES mfm_profiles(profile_id) ON DELETE CASCADE,
	recipient_profile_id TEXT NOT NULL REFERENCES mfm_profiles(profile_id) ON DELETE CASCADE,
	message TEXT NOT NULL CHECK (message = trim(message) AND length(message) BETWEEN 10 AND 500 AND instr(message, char(0)) = 0),
	status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	created_at INTEGER NOT NULL CHECK (created_at >= 0),
	decided_at INTEGER NULL CHECK (decided_at IS NULL OR decided_at >= created_at),
	CHECK (sender_profile_id <> recipient_profile_id),
	CHECK ((status = 'pending' AND decided_at IS NULL) OR (status <> 'pending' AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX introduction_pair ON introduction_requests(
	CASE WHEN sender_profile_id < recipient_profile_id THEN sender_profile_id ELSE recipient_profile_id END,
	CASE WHEN sender_profile_id < recipient_profile_id THEN recipient_profile_id ELSE sender_profile_id END
);
CREATE INDEX introduction_incoming ON introduction_requests(recipient_profile_id, status, created_at DESC, id);
CREATE INDEX introduction_sent ON introduction_requests(sender_profile_id, status, created_at DESC, id);
CREATE TRIGGER introduction_decision_guard BEFORE UPDATE ON introduction_requests
WHEN OLD.status <> 'pending' OR NEW.status = 'pending'
	OR NEW.revision <> OLD.revision + 1
	OR NEW.id <> OLD.id OR NEW.public_token <> OLD.public_token
	OR NEW.sender_profile_id <> OLD.sender_profile_id OR NEW.recipient_profile_id <> OLD.recipient_profile_id
	OR NEW.message <> OLD.message OR NEW.created_at <> OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'introduction decision is immutable');
END;

CREATE TABLE connection_sessions (
	telegram_user_id TEXT PRIMARY KEY NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
	state_json TEXT NOT NULL CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);
