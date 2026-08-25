CREATE TABLE profiles (
	id TEXT PRIMARY KEY NOT NULL CHECK (
		typeof(id) = 'text' AND length(id) = 36 AND id NOT GLOB '*[^0-9A-Fa-f-]*'
		AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
		AND length(replace(id, '-', '')) = 32
	),
	telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id),
	type TEXT NOT NULL CHECK (type IN ('blogger', 'telegram_channel', 'venue_or_brand')),
	display_name TEXT NOT NULL CHECK (length(display_name) > 0),
	description TEXT NOT NULL CHECK (length(description) > 0),
	city_code TEXT NOT NULL CHECK (city_code = 'ekaterinburg'),
	private_contact TEXT NOT NULL CHECK (length(private_contact) > 0),
	status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
	created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at)
);

CREATE UNIQUE INDEX profiles_one_active_per_user
	ON profiles (telegram_user_id)
	WHERE status = 'active';

CREATE INDEX profiles_telegram_user_status
	ON profiles (telegram_user_id, status);

CREATE TABLE profile_platforms (
	id TEXT PRIMARY KEY NOT NULL CHECK (
		typeof(id) = 'text' AND length(id) = 36 AND id NOT GLOB '*[^0-9A-Fa-f-]*'
		AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
		AND length(replace(id, '-', '')) = 32
	),
	profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	platform_type TEXT NOT NULL CHECK (platform_type IN ('telegram', 'instagram', 'vk', 'tiktok', 'youtube', 'website', 'other')),
	url TEXT NOT NULL CHECK (length(url) > 0),
	title TEXT NULL,
	username TEXT NULL,
	telegram_chat_id TEXT NULL,
	audience_size INTEGER NULL CHECK (audience_size IS NULL OR (typeof(audience_size) = 'integer' AND audience_size >= 0))
);

CREATE INDEX profile_platforms_profile_id
	ON profile_platforms (profile_id);

CREATE TABLE profile_topics (
	profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	topic TEXT NOT NULL CHECK (topic IN ('lifestyle', 'food', 'beauty', 'travel', 'city', 'events', 'family', 'sport', 'business', 'other')),
	PRIMARY KEY (profile_id, topic)
);
