DROP TABLE mfm_profile_specializations;

ALTER TABLE mfm_profiles ADD COLUMN about_text TEXT NULL
	CHECK (
		about_text IS NULL
		OR (
			typeof(about_text) = 'text'
			AND about_text = trim(about_text)
			AND length(about_text) BETWEEN 10 AND 500
			AND instr(about_text, char(0)) = 0
		)
	);
