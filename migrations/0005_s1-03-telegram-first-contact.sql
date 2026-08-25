ALTER TABLE profiles DROP COLUMN private_contact;

UPDATE profile_sessions
SET
	step = CASE WHEN step = 'private_contact' THEN 'review' ELSE step END,
	state_json = json_remove(
		CASE
			WHEN json_extract(state_json, '$.step') = 'private_contact'
				THEN json_set(state_json, '$.step', 'review')
			ELSE state_json
		END,
		'$.draft.privateContact'
	)
WHERE flow_type = 'profile';
