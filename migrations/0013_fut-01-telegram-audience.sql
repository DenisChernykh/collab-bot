ALTER TABLE profile_platforms
	ADD COLUMN audience_source TEXT NULL
	CHECK (audience_source IS NULL OR audience_source IN ('manual', 'telegram_api'));

ALTER TABLE profile_platforms
	ADD COLUMN audience_observed_at INTEGER NULL
	CHECK (
		(audience_source IS NULL AND audience_observed_at IS NULL)
		OR (
			audience_source IN ('manual', 'telegram_api')
			AND audience_size IS NOT NULL
			AND typeof(audience_observed_at) = 'integer'
			AND audience_observed_at >= 0
		)
	);
