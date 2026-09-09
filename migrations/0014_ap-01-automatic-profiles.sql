ALTER TABLE profiles RENAME COLUMN type TO type_legacy;

ALTER TABLE profiles ADD COLUMN type TEXT NULL
	CHECK (type IS NULL OR type IN ('blogger', 'telegram_channel', 'venue_or_brand'));

UPDATE profiles SET type = type_legacy;

ALTER TABLE profiles DROP COLUMN type_legacy;
