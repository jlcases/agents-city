-- A Road id may be reused only with a higher revision. Bind each one-time key
-- claim to that exact revision so an old consumed claim can never be reused or
-- prevent a fresh revision from receiving a different prekey.

ALTER TABLE device_one_time_keys ADD COLUMN claimed_road_revision INTEGER
  CHECK (claimed_road_revision IS NULL OR claimed_road_revision >= 1);

UPDATE device_one_time_keys
SET claimed_road_revision = (
  SELECT CASE
    WHEN roads.status IN ('revoking', 'revoked') AND roads.revision > 1
      THEN roads.revision - 1
    ELSE roads.revision
  END
  FROM roads WHERE roads.id = device_one_time_keys.claimed_road_id
)
WHERE claimed_road_id IS NOT NULL AND claimed_road_revision IS NULL;

CREATE UNIQUE INDEX idx_device_one_time_keys_road_revision
ON device_one_time_keys (claimed_road_id, claimed_road_revision)
WHERE claimed_road_id IS NOT NULL AND claimed_road_revision IS NOT NULL;
