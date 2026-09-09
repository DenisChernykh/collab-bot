ALTER TABLE telegram_users ADD COLUMN preferred_language TEXT NULL CHECK (preferred_language IN ('ru', 'en'));
ALTER TABLE telegram_users ADD COLUMN experience TEXT NOT NULL DEFAULT 'undecided' CHECK (experience IN ('undecided', 'classic', 'mfm'));
UPDATE telegram_users SET experience = 'classic';

CREATE TABLE mfm_profiles (
	profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	event_status TEXT NOT NULL CHECK (event_status IN ('participant', 'citizen_program', 'volunteer')),
	profile_type TEXT NOT NULL CHECK (profile_type IN ('specialist', 'media', 'project', 'business')),
	location_text TEXT NOT NULL CHECK (length(trim(location_text)) BETWEEN 1 AND 200),
	completed_at INTEGER NOT NULL CHECK (completed_at >= 0),
	updated_at INTEGER NOT NULL CHECK (updated_at >= completed_at),
	revision INTEGER NOT NULL CHECK (revision >= 1)
);
CREATE INDEX mfm_profiles_event ON mfm_profiles(event_status, profile_id);

CREATE TABLE mfm_profile_spheres (
	profile_id TEXT NOT NULL REFERENCES mfm_profiles(profile_id) ON DELETE CASCADE,
	sphere TEXT NOT NULL CHECK (sphere IN ('public_administration', 'media', 'science_education', 'entrepreneurship', 'digital_it', 'creative_industries', 'civic_engagement', 'sports_health')),
	PRIMARY KEY (profile_id, sphere)
);
CREATE INDEX mfm_spheres_lookup ON mfm_profile_spheres(sphere, profile_id);

CREATE TABLE mfm_profile_specializations (
	profile_id TEXT NOT NULL,
	sphere TEXT NOT NULL,
	specialization TEXT NOT NULL,
	PRIMARY KEY (profile_id, specialization),
	FOREIGN KEY (profile_id, sphere) REFERENCES mfm_profile_spheres(profile_id, sphere) ON DELETE CASCADE,
	CHECK (
		(sphere = 'media' AND specialization IN ('blogger', 'journalism', 'smm', 'pr', 'photo_video', 'producing')) OR
		(sphere = 'entrepreneurship' AND specialization IN ('business', 'startups', 'finance', 'marketing_sales', 'ecommerce', 'horeca')) OR
		(sphere = 'digital_it' AND specialization IN ('development', 'ai', 'data', 'product_project', 'ux_ui', 'cybersecurity')) OR
		(sphere = 'creative_industries' AND specialization IN ('design', 'fashion', 'music', 'cinema', 'art', 'architecture')) OR
		(sphere = 'science_education' AND specialization IN ('science', 'research', 'education', 'edtech', 'teaching')) OR
		(sphere = 'civic_engagement' AND specialization IN ('social_projects', 'volunteering', 'ngo', 'ecology', 'charity')) OR
		(sphere = 'sports_health' AND specialization IN ('sport', 'fitness', 'medicine', 'wellness')) OR
		(sphere = 'public_administration' AND specialization IN ('government', 'municipal', 'youth_policy', 'international'))
	)
);
CREATE INDEX mfm_specializations_lookup ON mfm_profile_specializations(specialization, profile_id);

CREATE TABLE mfm_profile_open_to (
	profile_id TEXT NOT NULL REFERENCES mfm_profiles(profile_id) ON DELETE CASCADE,
	intent TEXT NOT NULL CHECK (intent IN ('joint_projects', 'professional_communication', 'city_and_events')),
	PRIMARY KEY (profile_id, intent)
);

CREATE TABLE onboarding_sessions (
	telegram_user_id TEXT PRIMARY KEY NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
	state_json TEXT NOT NULL CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);
