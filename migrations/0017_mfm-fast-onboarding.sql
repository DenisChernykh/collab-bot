CREATE TABLE mfm_profile_contacts (
	profile_id TEXT PRIMARY KEY NOT NULL REFERENCES mfm_profiles(profile_id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('telegram_user', 'telegram_channel', 'telegram_group', 'external')),
	url TEXT NULL CHECK (
		url IS NULL OR (
			typeof(url) = 'text'
			AND length(url) BETWEEN 9 AND 2048
			AND lower(substr(url, 1, 8)) = 'https://'
			AND instr(url, char(0)) = 0
		)
	),
	username TEXT NULL CHECK (
		username IS NULL OR (
			typeof(username) = 'text'
			AND length(username) BETWEEN 5 AND 32
			AND username GLOB '[A-Za-z]*'
			AND username NOT GLOB '*[^A-Za-z0-9_]*'
		)
	),
	telegram_chat_id TEXT NULL CHECK (
		telegram_chat_id IS NULL OR (
			typeof(telegram_chat_id) = 'text'
			AND length(telegram_chat_id) BETWEEN 2 AND 21
			AND telegram_chat_id GLOB '-[0-9]*'
			AND substr(telegram_chat_id, 2) NOT GLOB '*[^0-9]*'
		)
	),
	title TEXT NULL CHECK (
		title IS NULL OR (
			typeof(title) = 'text'
			AND title = trim(title)
			AND length(title) BETWEEN 1 AND 100
			AND instr(title, char(0)) = 0
		)
	),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0),
	CHECK (
		(kind = 'telegram_user' AND url IS NULL AND username IS NULL AND telegram_chat_id IS NULL AND title IS NULL)
		OR (
			kind IN ('telegram_channel', 'telegram_group')
			AND url = 'https://t.me/' || username
			AND username IS NOT NULL
			AND telegram_chat_id IS NOT NULL
		)
		OR (kind = 'external' AND url IS NOT NULL AND username IS NULL AND telegram_chat_id IS NULL AND title IS NULL)
	)
);
