ALTER TABLE mfm_profiles ADD COLUMN photo_json TEXT NULL
 CHECK (photo_json IS NULL OR COALESCE(
  json_valid(photo_json) = 1
  AND json_type(photo_json) = 'object'
  AND json_type(photo_json, '$.fileId') = 'text'
  AND length(json_extract(photo_json, '$.fileId')) BETWEEN 1 AND 1024
  AND json_extract(photo_json, '$.fileId') NOT GLOB '*[^A-Za-z0-9_-]*'
  AND json_type(photo_json, '$.botId') = 'text'
  AND length(json_extract(photo_json, '$.botId')) BETWEEN 1 AND 20
  AND json_extract(photo_json, '$.botId') GLOB '[1-9]*'
  AND json_extract(photo_json, '$.botId') NOT GLOB '*[^0-9]*', 0));
