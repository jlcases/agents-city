-- Public identity and one-time prekeys for the Apache-licensed Olm Double
-- Ratchet. Private account/session pickles never leave the local device.

ALTER TABLE device_authorizations ADD COLUMN ratchet_identity_key TEXT;
ALTER TABLE device_authorizations ADD COLUMN ratchet_signing_key TEXT;
ALTER TABLE device_authorizations ADD COLUMN ratchet_prekeys_json TEXT;
ALTER TABLE device_authorizations ADD COLUMN ratchet_bundle_signature TEXT;

ALTER TABLE devices ADD COLUMN ratchet_identity_key TEXT;
ALTER TABLE devices ADD COLUMN ratchet_signing_key TEXT;

CREATE UNIQUE INDEX idx_devices_ratchet_identity
ON devices (ratchet_identity_key)
WHERE ratchet_identity_key IS NOT NULL;

CREATE TABLE device_one_time_keys (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 1 AND 64),
  public_key TEXT NOT NULL CHECK (length(public_key) BETWEEN 40 AND 64),
  status TEXT NOT NULL DEFAULT 'available' CHECK (
    status IN ('available', 'claimed', 'consumed')
  ),
  claimed_road_id TEXT REFERENCES roads(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  consumed_at TEXT,
  PRIMARY KEY (device_id, key_id),
  UNIQUE (device_id, public_key)
);

CREATE INDEX idx_device_one_time_keys_available
ON device_one_time_keys (device_id, status, created_at);

-- The lexicographically left endpoint starts the single bidirectional
-- session. Its peer prekey is claimed exactly once and never reused.
ALTER TABLE roads ADD COLUMN ratchet_responder_prekey_id TEXT;
ALTER TABLE roads ADD COLUMN ratchet_responder_prekey TEXT;
