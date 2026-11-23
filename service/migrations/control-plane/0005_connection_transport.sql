-- A connection reaches one computer-level reception, never a user-selected
-- city. The existing Road/relay primitive carries the ciphertext between two
-- hidden reception endpoints, so it inherits the same grants, signatures,
-- lanes, backpressure and revocation behavior without exposing city names.

ALTER TABLE cities ADD COLUMN kind TEXT NOT NULL DEFAULT 'city' CHECK (
  kind IN ('city', 'reception')
);

ALTER TABLE roads ADD COLUMN kind TEXT NOT NULL DEFAULT 'city' CHECK (
  kind IN ('city', 'connection')
);

ALTER TABLE roads ADD COLUMN connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX one_transport_road_per_connection
ON roads (connection_id)
WHERE kind = 'connection';

CREATE UNIQUE INDEX one_reception_endpoint_per_device
ON cities (device_id)
WHERE kind = 'reception';

CREATE TRIGGER validate_reception_endpoint_before_insert
BEFORE INSERT ON cities
WHEN NEW.kind = 'reception'
BEGIN
  SELECT RAISE(ABORT, 'invalid_reception_endpoint') WHERE
    NEW.connected <> 1
    OR NEW.address <> (
      SELECT a.owner_prefix || '/rx-' || substr(replace(d.id, '-', ''), 1, 12)
      FROM accounts a JOIN devices d ON d.account_id = a.id
      WHERE a.id = NEW.account_id AND d.id = NEW.device_id
    );
END;

DROP TRIGGER enforce_city_allowance_before_insert;
CREATE TRIGGER enforce_city_allowance_before_insert
BEFORE INSERT ON cities
WHEN NEW.connected = 1 AND NEW.kind = 'city'
BEGIN
  SELECT RAISE(ABORT, 'city_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM cities
    WHERE account_id = NEW.account_id AND connected = 1 AND kind = 'city'
  ) >= 3
    + 7 * EXISTS (
      SELECT 1 FROM spaces
      WHERE owner_account_id = NEW.account_id AND plan_code IN ('company', 'custom') AND status = 'active'
    )
    + 90 * EXISTS (
      SELECT 1 FROM spaces
      WHERE owner_account_id = NEW.account_id AND plan_code = 'custom' AND status = 'active'
    );
END;

DROP TRIGGER enforce_road_allowance_before_insert;
CREATE TRIGGER enforce_road_allowance_before_insert
BEFORE INSERT ON roads
WHEN NEW.status IN ('provisioning', 'active')
BEGIN
  SELECT RAISE(ABORT, 'road_allowance_exceeded') WHERE NEW.kind = 'city' AND (
    SELECT COUNT(*) FROM roads
    WHERE space_id = NEW.space_id
      AND kind = 'city'
      AND status IN ('provisioning', 'active', 'revoking', 'suspended')
  ) >= 5
    + 95 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 99900 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');

  SELECT RAISE(ABORT, 'connection_transport_allowance_exceeded')
  WHERE NEW.kind = 'connection' AND (
    SELECT COUNT(*) FROM roads
    WHERE space_id = NEW.space_id
      AND kind = 'connection'
      AND status IN ('provisioning', 'active', 'revoking', 'suspended')
  ) >= 3
    + 22 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 9975 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');
END;
