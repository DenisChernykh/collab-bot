ALTER TABLE collaborations ADD COLUMN first_application_at INTEGER NULL
	CHECK (
		first_application_at IS NULL
		OR (typeof(first_application_at) = 'integer' AND first_application_at >= 0)
	);

CREATE TRIGGER collaborations_first_application_at_immutable
BEFORE UPDATE OF first_application_at ON collaborations
FOR EACH ROW
WHEN OLD.first_application_at IS NOT NULL
	AND NEW.first_application_at IS NOT OLD.first_application_at
BEGIN
	SELECT RAISE(ABORT, 'collaboration first_application_at is immutable');
END;

CREATE TABLE applications (
	id TEXT PRIMARY KEY NOT NULL CHECK (
		typeof(id) = 'text'
		AND length(id) = 36
		AND id NOT GLOB '*[^0-9A-Fa-f-]*'
		AND substr(id, 9, 1) = '-'
		AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-'
		AND substr(id, 24, 1) = '-'
		AND length(replace(id, '-', '')) = 32
	),
	collaboration_id TEXT NOT NULL REFERENCES collaborations(id),
	applicant_profile_id TEXT NOT NULL REFERENCES profiles(id),
	message TEXT NOT NULL CHECK (
		typeof(message) = 'text'
		AND length(message) BETWEEN 10 AND 500
		AND instr(message, char(0)) = 0
	),
	terms_version INTEGER NOT NULL CHECK (
		typeof(terms_version) = 'integer' AND terms_version >= 1
	),
	collaboration_version INTEGER NOT NULL CHECK (
		typeof(collaboration_version) = 'integer' AND collaboration_version >= 1
	),
	status TEXT NOT NULL CHECK (
		status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'closed')
	),
	decided_by_profile_id TEXT NULL REFERENCES profiles(id),
	decided_at INTEGER NULL CHECK (
		decided_at IS NULL OR (typeof(decided_at) = 'integer' AND decided_at >= 0)
	),
	created_at INTEGER NOT NULL CHECK (
		typeof(created_at) = 'integer' AND created_at >= 0
	),
	CHECK (
		(status IN ('accepted', 'rejected') AND decided_by_profile_id IS NOT NULL AND decided_at IS NOT NULL)
		OR (status IN ('pending', 'withdrawn', 'closed') AND decided_by_profile_id IS NULL AND decided_at IS NULL)
	),
	CHECK (decided_at IS NULL OR decided_at >= created_at)
);

CREATE UNIQUE INDEX applications_one_per_profile
	ON applications (collaboration_id, applicant_profile_id);

CREATE INDEX applications_applicant_created
	ON applications (applicant_profile_id, created_at DESC, id DESC);

CREATE INDEX applications_collaboration_status_created
	ON applications (collaboration_id, status, created_at DESC, id DESC);

CREATE TRIGGER applications_submission_fields_immutable
BEFORE UPDATE OF collaboration_id, applicant_profile_id, message, terms_version, collaboration_version, created_at ON applications
FOR EACH ROW
WHEN NEW.collaboration_id IS NOT OLD.collaboration_id
	OR NEW.applicant_profile_id IS NOT OLD.applicant_profile_id
	OR NEW.message IS NOT OLD.message
	OR NEW.terms_version IS NOT OLD.terms_version
	OR NEW.collaboration_version IS NOT OLD.collaboration_version
	OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'application submission fields are immutable');
END;
