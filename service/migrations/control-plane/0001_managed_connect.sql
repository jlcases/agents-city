PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_handle TEXT NOT NULL UNIQUE CHECK (length(user_handle) BETWEEN 32 AND 128),
  owner_prefix TEXT NOT NULL UNIQUE CHECK (
    length(owner_prefix) BETWEEN 1 AND 32
    AND owner_prefix NOT GLOB '*[^a-z0-9_-]*'
  ),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL CHECK (length(public_key) BETWEEN 32 AND 4096),
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports TEXT NOT NULL DEFAULT '[]' CHECK (length(transports) <= 512),
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  label TEXT NOT NULL DEFAULT 'Passkey' CHECK (length(label) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX idx_passkeys_account ON passkeys (account_id, created_at);

CREATE TABLE webauthn_challenges (
  challenge_hash TEXT PRIMARY KEY CHECK (length(challenge_hash) = 64),
  flow TEXT NOT NULL CHECK (flow IN ('registration', 'authentication')),
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  user_handle TEXT,
  owner_prefix TEXT,
  rp_id TEXT NOT NULL CHECK (length(rp_id) BETWEEN 1 AND 253),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_webauthn_challenges_expiry ON webauthn_challenges (expires_at);

CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_recovery_codes_account ON recovery_codes (account_id, used_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_account ON sessions (account_id, expires_at);

CREATE TABLE device_authorizations (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE CHECK (length(device_code_hash) = 64),
  user_code_hash TEXT NOT NULL UNIQUE CHECK (length(user_code_hash) = 64),
  machine_name TEXT NOT NULL CHECK (length(machine_name) BETWEEN 1 AND 100),
  platform TEXT CHECK (platform IS NULL OR length(platform) <= 80),
  signing_public_jwk TEXT NOT NULL CHECK (length(signing_public_jwk) BETWEEN 40 AND 2048),
  encryption_public_jwk TEXT NOT NULL CHECK (length(encryption_public_jwk) BETWEEN 40 AND 2048),
  signing_thumbprint TEXT NOT NULL CHECK (length(signing_thumbprint) BETWEEN 16 AND 128),
  encryption_thumbprint TEXT NOT NULL CHECK (length(encryption_thumbprint) BETWEEN 16 AND 128),
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  owner_prefix TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed', 'denied', 'expired')),
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_device_authorizations_expiry ON device_authorizations (status, expires_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  authorization_id TEXT UNIQUE REFERENCES device_authorizations(id),
  machine_name TEXT NOT NULL CHECK (length(machine_name) BETWEEN 1 AND 100),
  platform TEXT CHECK (platform IS NULL OR length(platform) <= 80),
  signing_public_jwk TEXT NOT NULL CHECK (length(signing_public_jwk) BETWEEN 40 AND 2048),
  encryption_public_jwk TEXT NOT NULL CHECK (length(encryption_public_jwk) BETWEEN 40 AND 2048),
  signing_thumbprint TEXT NOT NULL CHECK (length(signing_thumbprint) BETWEEN 16 AND 128),
  encryption_thumbprint TEXT NOT NULL CHECK (length(encryption_thumbprint) BETWEEN 16 AND 128),
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'revoked')),
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_devices_account_status ON devices (account_id, status);

CREATE TABLE device_nonces (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL CHECK (length(nonce_hash) = 64),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, nonce_hash)
);

CREATE INDEX idx_device_nonces_expiry ON device_nonces (expires_at);

CREATE TABLE cities (
  address TEXT PRIMARY KEY CHECK (
    length(address) BETWEEN 3 AND 65
    AND address NOT GLOB '*[^a-z0-9_/-]*'
  ),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  city_name TEXT NOT NULL CHECK (length(city_name) BETWEEN 1 AND 100),
  connected INTEGER NOT NULL DEFAULT 1 CHECK (connected IN (0, 1)),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, device_id, address)
);

CREATE INDEX idx_cities_account_connected ON cities (account_id, connected);
CREATE INDEX idx_cities_device ON cities (device_id, connected);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 48),
  plan_code TEXT NOT NULL DEFAULT 'free' CHECK (plan_code IN ('free', 'company', 'custom')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'suspended', 'closed')),
  member_invites_enabled INTEGER NOT NULL DEFAULT 1 CHECK (member_invites_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_account_id, slug)
);

CREATE INDEX idx_spaces_owner_status ON spaces (owner_account_id, status);

CREATE TABLE space_members (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  joined_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (space_id, account_id)
);

CREATE INDEX idx_space_members_account ON space_members (account_id, status);

CREATE TABLE subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_price_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'canceled', 'unpaid', 'paused'
  )),
  plan_code TEXT NOT NULL CHECK (plan_code IN ('company', 'custom')),
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_subscriptions_space_status ON subscriptions (space_id, status);
CREATE INDEX idx_subscriptions_customer ON subscriptions (stripe_customer_id);

CREATE TABLE road_invitations (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_city TEXT NOT NULL REFERENCES cities(address) ON DELETE CASCADE,
  purpose TEXT CHECK (purpose IS NULL OR length(purpose) <= 160),
  target_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  target_city TEXT REFERENCES cities(address) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_road_invitations_space_status ON road_invitations (space_id, status, expires_at);
CREATE INDEX idx_road_invitations_account ON road_invitations (source_account_id, created_at);

CREATE TABLE roads (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  left_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  left_city TEXT NOT NULL REFERENCES cities(address) ON DELETE CASCADE,
  right_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  right_city TEXT NOT NULL REFERENCES cities(address) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'revoking', 'revoked', 'suspended')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_from_invitation_id TEXT UNIQUE REFERENCES road_invitations(id),
  created_at TEXT NOT NULL,
  provisioned_at TEXT,
  revoked_at TEXT,
  CHECK (left_city < right_city),
  UNIQUE (space_id, left_city, right_city)
);

CREATE INDEX idx_roads_space_status ON roads (space_id, status);
CREATE INDEX idx_roads_left ON roads (left_account_id, left_city, status);
CREATE INDEX idx_roads_right ON roads (right_account_id, right_city, status);

CREATE TABLE stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 120),
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  processed_at TEXT NOT NULL
);

CREATE TABLE rate_limits (
  bucket TEXT NOT NULL CHECK (length(bucket) = 40),
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);

CREATE TABLE security_audit (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 16 AND 64),
  actor_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  actor_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_type TEXT CHECK (target_type IS NULL OR length(target_type) <= 40),
  target_id TEXT CHECK (target_id IS NULL OR length(target_id) <= 100),
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
  detail_code TEXT CHECK (detail_code IS NULL OR length(detail_code) <= 80),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_security_audit_actor ON security_audit (actor_account_id, created_at DESC);
CREATE INDEX idx_security_audit_created ON security_audit (created_at DESC);

CREATE TRIGGER prune_sessions_after_insert
AFTER INSERT ON sessions
BEGIN
  DELETE FROM sessions WHERE expires_at <= datetime('now');
END;

CREATE TRIGGER prune_challenges_after_insert
AFTER INSERT ON webauthn_challenges
BEGIN
  DELETE FROM webauthn_challenges WHERE expires_at <= datetime('now');
END;

CREATE TRIGGER prune_device_authorizations_after_insert
AFTER INSERT ON device_authorizations
BEGIN
  UPDATE device_authorizations
  SET status = 'expired'
  WHERE status IN ('pending', 'approved') AND expires_at <= datetime('now');

  DELETE FROM device_authorizations
  WHERE expires_at < datetime('now', '-30 days')
    AND NOT EXISTS (
      SELECT 1 FROM devices WHERE devices.authorization_id = device_authorizations.id
    );
END;

CREATE TRIGGER prune_device_nonces_after_insert
AFTER INSERT ON device_nonces
BEGIN
  DELETE FROM device_nonces WHERE expires_at <= datetime('now');
END;

CREATE TRIGGER prune_road_invitations_after_insert
AFTER INSERT ON road_invitations
BEGIN
  UPDATE road_invitations
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at <= datetime('now');

  DELETE FROM road_invitations
  WHERE status IN ('expired', 'revoked')
    AND created_at < datetime('now', '-30 days')
    AND NOT EXISTS (
      SELECT 1 FROM roads WHERE roads.created_from_invitation_id = road_invitations.id
    );
END;

CREATE TRIGGER prune_rate_limits_after_insert
AFTER INSERT ON rate_limits
BEGIN
  DELETE FROM rate_limits WHERE window_start < datetime('now', '-2 days');
END;

CREATE TRIGGER prune_security_audit_after_insert
AFTER INSERT ON security_audit
BEGIN
  DELETE FROM security_audit WHERE created_at < datetime('now', '-90 days');
END;
