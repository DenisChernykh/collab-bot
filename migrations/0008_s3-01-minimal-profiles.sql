ALTER TABLE profiles RENAME COLUMN description TO description_legacy;

ALTER TABLE profiles ADD COLUMN description TEXT NULL
	CHECK (
		description IS NULL
		OR (typeof(description) = 'text' AND length(description) BETWEEN 10 AND 500)
	);

UPDATE profiles
SET description = description_legacy;

ALTER TABLE profiles DROP COLUMN description_legacy;
