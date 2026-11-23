CREATE TRIGGER enforce_city_allowance_before_insert
BEFORE INSERT ON cities
WHEN NEW.connected = 1 AND NOT EXISTS (SELECT 1 FROM cities WHERE address = NEW.address)
BEGIN
  SELECT RAISE(ABORT, 'city_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM cities WHERE account_id = NEW.account_id AND connected = 1
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

CREATE TRIGGER enforce_city_allowance_before_reconnect
BEFORE UPDATE OF connected ON cities
WHEN OLD.connected = 0 AND NEW.connected = 1
BEGIN
  SELECT RAISE(ABORT, 'city_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM cities WHERE account_id = NEW.account_id AND connected = 1
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

CREATE TRIGGER enforce_road_allowance_before_insert
BEFORE INSERT ON roads
WHEN NEW.status IN ('provisioning', 'active')
BEGIN
  SELECT RAISE(ABORT, 'road_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM roads
    WHERE space_id = NEW.space_id AND status IN ('provisioning', 'active', 'revoking', 'suspended')
  ) >= 5
    + 95 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 99900 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');
END;

CREATE TRIGGER enforce_guest_allowance_before_insert
BEFORE INSERT ON space_members
WHEN NEW.role = 'guest' AND NEW.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM space_members WHERE space_id = NEW.space_id AND account_id = NEW.account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'guest_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM space_members
    WHERE space_id = NEW.space_id AND role = 'guest' AND status = 'active'
  ) >= 3
    + 22 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 9975 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');
END;
