ALTER TABLE subscriptions
ADD COLUMN stripe_event_created INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER enforce_invitation_allowance_before_insert
BEFORE INSERT ON road_invitations
BEGIN
  SELECT RAISE(ABORT, 'invitation_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM road_invitations
    WHERE space_id = NEW.space_id AND created_at >= datetime('now', '-1 day')
  ) >= 5
    + 95 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 9_900 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');
END;

CREATE TRIGGER prune_stripe_events_after_insert
AFTER INSERT ON stripe_events
BEGIN
  DELETE FROM stripe_events
  WHERE processed_at < datetime('now', '-90 days');
END;
