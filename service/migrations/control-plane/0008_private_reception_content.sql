-- The cloud connection request is consent metadata only. Human-written content
-- starts after acceptance and travels through the end-to-end encrypted
-- reception Road. Keep the legacy columns constrained to a fixed marker so an
-- older caller cannot silently reintroduce readable introductions or reasons.

UPDATE connection_requests
SET intro_text = '[content travels on private Road]',
    rejection_reason = NULL;

DROP TRIGGER IF EXISTS prune_connection_requests_after_insert;

CREATE TRIGGER prune_connection_requests_after_insert
AFTER INSERT ON connection_requests
BEGIN
  UPDATE connection_requests
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at <= datetime('now');

  DELETE FROM connection_requests
  WHERE status IN ('rejected', 'withdrawn', 'expired')
    AND reviewed_at < datetime('now', '-90 days');
END;

CREATE TRIGGER enforce_private_connection_content_before_insert
BEFORE INSERT ON connection_requests
BEGIN
  SELECT RAISE(ABORT, 'connection_content_requires_private_road') WHERE
    NEW.intro_text <> '[content travels on private Road]'
    OR NEW.rejection_reason IS NOT NULL;
END;

CREATE TRIGGER enforce_private_connection_content_before_update
BEFORE UPDATE OF intro_text, rejection_reason ON connection_requests
BEGIN
  SELECT RAISE(ABORT, 'connection_content_requires_private_road') WHERE
    NEW.intro_text <> '[content travels on private Road]'
    OR NEW.rejection_reason IS NOT NULL;
END;
