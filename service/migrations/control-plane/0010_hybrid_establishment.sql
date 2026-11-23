-- Experimental v4 hybrid establishment. Existing devices remain explicitly
-- classical and must be re-enrolled; no migration claims post-quantum support
-- for a key record that was published before ML-KEM prekeys existed.

ALTER TABLE device_authorizations ADD COLUMN hybrid_prekeys_json TEXT
  CHECK (hybrid_prekeys_json IS NULL OR length(hybrid_prekeys_json) BETWEEN 512 AND 65536);

ALTER TABLE devices ADD COLUMN establishment_suite TEXT NOT NULL
  DEFAULT 'OLM-V1-CURVE25519-AES256-HMAC-SHA256'
  CHECK (establishment_suite IN (
    'OLM-V1-CURVE25519-AES256-HMAC-SHA256',
    'AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1'
  ));

CREATE TABLE device_hybrid_one_time_keys (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 16 AND 64),
  public_key TEXT NOT NULL CHECK (length(public_key) BETWEEN 1500 AND 1700),
  signature TEXT NOT NULL CHECK (length(signature) BETWEEN 80 AND 128),
  signing_key_id TEXT NOT NULL CHECK (length(signing_key_id) = 43),
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'claimed', 'consumed')),
  claimed_road_id TEXT REFERENCES roads(id) ON DELETE CASCADE,
  claimed_road_revision INTEGER
    CHECK (claimed_road_revision IS NULL OR claimed_road_revision >= 1),
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  consumed_at TEXT,
  PRIMARY KEY (device_id, key_id),
  UNIQUE (public_key),
  CHECK (
    (status = 'available' AND claimed_road_id IS NULL AND claimed_road_revision IS NULL)
    OR (status IN ('claimed', 'consumed')
      AND claimed_road_id IS NOT NULL AND claimed_road_revision IS NOT NULL)
  )
);

CREATE INDEX idx_device_hybrid_keys_available
ON device_hybrid_one_time_keys (device_id, status, created_at);

CREATE UNIQUE INDEX idx_device_hybrid_keys_road_revision
ON device_hybrid_one_time_keys (claimed_road_id, claimed_road_revision)
WHERE claimed_road_id IS NOT NULL AND claimed_road_revision IS NOT NULL;

ALTER TABLE roads ADD COLUMN establishment_suite TEXT NOT NULL
  DEFAULT 'OLM-V1-CURVE25519-AES256-HMAC-SHA256'
  CHECK (establishment_suite IN (
    'OLM-V1-CURVE25519-AES256-HMAC-SHA256',
    'AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1'
  ));
ALTER TABLE roads ADD COLUMN hybrid_responder_prekey_id TEXT;
ALTER TABLE roads ADD COLUMN hybrid_responder_prekey TEXT;
ALTER TABLE roads ADD COLUMN hybrid_responder_prekey_signature TEXT;
ALTER TABLE roads ADD COLUMN hybrid_responder_signing_key_id TEXT;
ALTER TABLE roads ADD COLUMN hybrid_responder_key_version INTEGER;
