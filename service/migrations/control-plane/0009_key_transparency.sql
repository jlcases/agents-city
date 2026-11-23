-- Device keys become publishable only after the device signs its canonical
-- record. Existing v3 devices remain explicitly legacy until they re-enrol;
-- they must never be presented as transparency-verified by migration fiat.

ALTER TABLE devices ADD COLUMN transparency_status TEXT NOT NULL DEFAULT 'legacy'
  CHECK (transparency_status IN (
    'legacy', 'awaiting_signature', 'pending', 'published', 'revoked_pending', 'revoked', 'failed'
  ));
ALTER TABLE devices ADD COLUMN transparency_version INTEGER NOT NULL DEFAULT 0
  CHECK (transparency_version BETWEEN 0 AND 64);
ALTER TABLE devices ADD COLUMN transparency_record_hash TEXT
  CHECK (transparency_record_hash IS NULL OR length(transparency_record_hash) = 43);
ALTER TABLE devices ADD COLUMN transparency_published_at TEXT;

CREATE INDEX idx_devices_transparency_status
ON devices (transparency_status, created_at);

CREATE TABLE transparency_outbox (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_version INTEGER NOT NULL CHECK (device_version BETWEEN 1 AND 64),
  record_json TEXT NOT NULL CHECK (length(record_json) BETWEEN 200 AND 16384),
  device_signature TEXT CHECK (device_signature IS NULL OR length(device_signature) BETWEEN 80 AND 128),
  previous_device_signature TEXT CHECK (
    previous_device_signature IS NULL OR length(previous_device_signature) BETWEEN 80 AND 128
  ),
  recovery_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 120),
  log_sequence INTEGER CHECK (log_sequence IS NULL OR log_sequence >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (device_id, device_version),
  CHECK (
    (device_signature IS NOT NULL AND recovery_event_id IS NULL)
    OR (device_signature IS NULL AND previous_device_signature IS NULL AND recovery_event_id IS NOT NULL)
  )
);

CREATE INDEX idx_transparency_outbox_retry
ON transparency_outbox (status, next_attempt_at, created_at);
