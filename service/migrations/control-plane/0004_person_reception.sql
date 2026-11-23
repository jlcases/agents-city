CREATE TABLE reception_settings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  routing_mode TEXT NOT NULL DEFAULT 'manual' CHECK (routing_mode IN ('manual', 'auto')),
  review_policy TEXT NOT NULL DEFAULT 'every_message' CHECK (
    review_policy IN ('every_message', 'new_thread')
  ),
  updated_at TEXT NOT NULL
);

CREATE TABLE reception_links (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  sponsor_space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT CHECK (label IS NULL OR length(label) <= 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'consumed', 'revoked', 'expired')
  ),
  request_limit INTEGER NOT NULL DEFAULT 1 CHECK (request_limit BETWEEN 1 AND 100),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND request_limit),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_reception_links_owner_status
ON reception_links (owner_account_id, status, expires_at);

CREATE TABLE connection_requests (
  id TEXT PRIMARY KEY,
  reception_link_id TEXT REFERENCES reception_links(id) ON DELETE SET NULL,
  target_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requester_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  intro_text TEXT NOT NULL CHECK (length(intro_text) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'reviewing', 'accepted', 'rejected', 'withdrawn', 'expired')
  ),
  decision_token TEXT CHECK (decision_token IS NULL OR length(decision_token) = 36),
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500),
  expires_at TEXT NOT NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (target_account_id <> requester_account_id)
);

CREATE INDEX idx_connection_requests_target_status
ON connection_requests (target_account_id, status, created_at DESC);

CREATE INDEX idx_connection_requests_requester_status
ON connection_requests (requester_account_id, status, created_at DESC);

CREATE UNIQUE INDEX one_open_request_per_pair
ON connection_requests (
  MIN(target_account_id, requester_account_id),
  MAX(target_account_id, requester_account_id)
)
WHERE status IN ('pending', 'reviewing');

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  sponsor_space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  sponsor_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  left_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  right_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  left_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  right_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  left_endpoint TEXT REFERENCES cities(address) ON DELETE SET NULL,
  right_endpoint TEXT REFERENCES cities(address) ON DELETE SET NULL,
  transport_road_id TEXT REFERENCES roads(id) ON DELETE SET NULL,
  created_from_request_id TEXT NOT NULL UNIQUE REFERENCES connection_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (
    status IN (
      'provisioning', 'active', 'suspended', 'blocking', 'blocked',
      'revoking', 'revoked'
    )
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (left_account_id < right_account_id),
  CHECK (sponsor_account_id IN (left_account_id, right_account_id)),
  CHECK (
    status IN ('provisioning', 'revoked')
    OR (
      left_device_id IS NOT NULL AND right_device_id IS NOT NULL
      AND left_endpoint IS NOT NULL AND right_endpoint IS NOT NULL
      AND transport_road_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX one_live_connection_per_pair
ON connections (left_account_id, right_account_id)
WHERE status IN (
  'provisioning', 'active', 'suspended', 'blocking', 'blocked', 'revoking'
);

CREATE INDEX idx_connections_left_status
ON connections (left_account_id, status, created_at DESC);

CREATE INDEX idx_connections_right_status
ON connections (right_account_id, status, created_at DESC);

CREATE INDEX idx_connections_sponsor_status
ON connections (sponsor_space_id, status, created_at DESC);

CREATE TRIGGER enforce_reception_link_allowance_before_insert
BEFORE INSERT ON reception_links
BEGIN
  SELECT RAISE(ABORT, 'reception_link_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM reception_links
    WHERE sponsor_space_id = NEW.sponsor_space_id AND created_at >= datetime('now', '-1 day')
  ) >= 5
    + 95 * ((SELECT plan_code FROM spaces WHERE id = NEW.sponsor_space_id) IN ('company', 'custom'))
    + 9_900 * ((SELECT plan_code FROM spaces WHERE id = NEW.sponsor_space_id) = 'custom');
END;

CREATE TRIGGER validate_connection_request_before_insert
BEFORE INSERT ON connection_requests
BEGIN
  SELECT RAISE(ABORT, 'reception_link_unavailable') WHERE NOT EXISTS (
    SELECT 1 FROM reception_links
    WHERE id = NEW.reception_link_id
      AND owner_account_id = NEW.target_account_id
      AND status = 'active'
      AND used_count < request_limit
      AND expires_at > datetime('now')
  );
  SELECT RAISE(ABORT, 'connection_already_exists') WHERE EXISTS (
    SELECT 1 FROM connections
    WHERE left_account_id = MIN(NEW.target_account_id, NEW.requester_account_id)
      AND right_account_id = MAX(NEW.target_account_id, NEW.requester_account_id)
      AND status IN (
        'provisioning', 'active', 'suspended', 'blocking', 'blocked', 'revoking'
      )
  );
END;

CREATE TRIGGER consume_reception_link_after_request
AFTER INSERT ON connection_requests
BEGIN
  UPDATE reception_links
  SET used_count = used_count + 1,
      status = CASE WHEN used_count + 1 >= request_limit THEN 'consumed' ELSE status END
  WHERE id = NEW.reception_link_id;
END;

CREATE TRIGGER enforce_connection_allowance_before_insert
BEFORE INSERT ON connections
BEGIN
  SELECT RAISE(ABORT, 'connection_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM connections
    WHERE sponsor_space_id = NEW.sponsor_space_id
      AND status IN (
        'provisioning', 'active', 'suspended', 'blocking', 'blocked', 'revoking'
      )
  ) >= 3
    + 22 * ((SELECT plan_code FROM spaces WHERE id = NEW.sponsor_space_id) IN ('company', 'custom'))
    + 9_975 * ((SELECT plan_code FROM spaces WHERE id = NEW.sponsor_space_id) = 'custom');
END;

CREATE TRIGGER prune_reception_links_after_insert
AFTER INSERT ON reception_links
BEGIN
  UPDATE reception_links
  SET status = 'expired'
  WHERE status = 'active' AND expires_at <= datetime('now');

  DELETE FROM reception_links
  WHERE status IN ('consumed', 'revoked', 'expired')
    AND created_at < datetime('now', '-30 days');
END;

CREATE TRIGGER prune_connection_requests_after_insert
AFTER INSERT ON connection_requests
BEGIN
  UPDATE connection_requests
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at <= datetime('now');

  UPDATE connection_requests
  SET intro_text = '[removed after retention window]', rejection_reason = NULL
  WHERE status IN ('accepted', 'rejected', 'withdrawn', 'expired')
    AND reviewed_at < datetime('now', '-30 days')
    AND intro_text <> '[removed after retention window]';

  DELETE FROM connection_requests
  WHERE status IN ('rejected', 'withdrawn', 'expired')
    AND reviewed_at < datetime('now', '-90 days');
END;
