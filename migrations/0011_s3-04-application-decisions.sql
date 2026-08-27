ALTER TABLE collaborations ADD COLUMN matched_at INTEGER NULL
	CHECK (
		matched_at IS NULL
		OR (
			typeof(matched_at) = 'integer'
			AND matched_at >= 0
			AND (published_at IS NULL OR matched_at >= published_at)
			AND matched_at <= updated_at
		)
	);

UPDATE collaborations
SET matched_at = updated_at
WHERE status IN ('matched', 'completed')
	AND matched_at IS NULL;

CREATE TRIGGER collaborations_matched_at_immutable
BEFORE UPDATE OF matched_at ON collaborations
FOR EACH ROW
WHEN OLD.matched_at IS NOT NULL
	AND NEW.matched_at IS NOT OLD.matched_at
BEGIN
	SELECT RAISE(ABORT, 'collaboration matched_at is immutable');
END;

CREATE TRIGGER collaborations_matched_at_coherence_update
BEFORE UPDATE OF status, matched_at ON collaborations
FOR EACH ROW
WHEN (NEW.status IN ('matched', 'completed') AND NEW.matched_at IS NULL)
	OR (
		NEW.matched_at IS NOT NULL
		AND NEW.status NOT IN ('matched', 'completed', 'cancelled', 'hidden')
	)
BEGIN
	SELECT RAISE(ABORT, 'collaboration matched_at is incoherent with status');
END;

CREATE TRIGGER applications_status_transition_guard
BEFORE UPDATE OF status ON applications
FOR EACH ROW
WHEN NEW.status IS NOT OLD.status
	AND (
		OLD.status <> 'pending'
		OR NEW.status NOT IN ('accepted', 'rejected', 'withdrawn', 'closed')
	)
BEGIN
	SELECT RAISE(ABORT, 'application status transition is terminal');
END;

CREATE TRIGGER applications_terminal_decision_immutable
BEFORE UPDATE OF decided_by_profile_id, decided_at ON applications
FOR EACH ROW
WHEN OLD.status <> 'pending'
	AND (
		NEW.decided_by_profile_id IS NOT OLD.decided_by_profile_id
		OR NEW.decided_at IS NOT OLD.decided_at
	)
BEGIN
	SELECT RAISE(ABORT, 'application decision is immutable');
END;

CREATE TRIGGER applications_author_decider_guard_insert
BEFORE INSERT ON applications
FOR EACH ROW
WHEN NEW.status IN ('accepted', 'rejected')
	AND NOT EXISTS (
		SELECT 1
		FROM collaborations collaboration
		WHERE collaboration.id = NEW.collaboration_id
			AND collaboration.author_profile_id = NEW.decided_by_profile_id
	)
BEGIN
	SELECT RAISE(ABORT, 'application decision must belong to the collaboration author');
END;

CREATE TRIGGER applications_author_decider_guard_update
BEFORE UPDATE OF status, decided_by_profile_id ON applications
FOR EACH ROW
WHEN NEW.status IN ('accepted', 'rejected')
	AND NOT EXISTS (
		SELECT 1
		FROM collaborations collaboration
		WHERE collaboration.id = NEW.collaboration_id
			AND collaboration.author_profile_id = NEW.decided_by_profile_id
	)
BEGIN
	SELECT RAISE(ABORT, 'application decision must belong to the collaboration author');
END;

CREATE TRIGGER applications_accepted_capacity_guard_insert
BEFORE INSERT ON applications
FOR EACH ROW
WHEN NEW.status = 'accepted'
	AND NOT EXISTS (
		SELECT 1
		FROM collaborations collaboration
		WHERE collaboration.id = NEW.collaboration_id
			AND collaboration.slots_total IS NOT NULL
			AND (
				SELECT count(*)
				FROM applications accepted
				WHERE accepted.collaboration_id = NEW.collaboration_id
					AND accepted.status = 'accepted'
			) < collaboration.slots_total
	)
BEGIN
	SELECT RAISE(ABORT, 'accepted applications exceed collaboration capacity');
END;

CREATE TRIGGER applications_accepted_capacity_guard_update
BEFORE UPDATE OF status ON applications
FOR EACH ROW
WHEN NEW.status = 'accepted'
	AND OLD.status <> 'accepted'
	AND NOT EXISTS (
		SELECT 1
		FROM collaborations collaboration
		WHERE collaboration.id = NEW.collaboration_id
			AND collaboration.slots_total IS NOT NULL
			AND (
				SELECT count(*)
				FROM applications accepted
				WHERE accepted.collaboration_id = NEW.collaboration_id
					AND accepted.status = 'accepted'
			) < collaboration.slots_total
	)
BEGIN
	SELECT RAISE(ABORT, 'accepted applications exceed collaboration capacity');
END;

CREATE TRIGGER collaborations_match_guard_update
BEFORE UPDATE OF status ON collaborations
FOR EACH ROW
WHEN NEW.status = 'matched'
	AND OLD.status <> 'matched'
	AND (
		NEW.matched_at IS NULL
		OR NOT EXISTS (
			SELECT 1
			FROM applications accepted
			WHERE accepted.collaboration_id = NEW.id
				AND accepted.status = 'accepted'
		)
		OR EXISTS (
			SELECT 1
			FROM applications pending
			WHERE pending.collaboration_id = NEW.id
				AND pending.status = 'pending'
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'matched collaboration requires accepted applications and no pending applications');
END;
