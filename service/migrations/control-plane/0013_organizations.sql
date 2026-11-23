-- An organization is a space that several accounts belong to. Belonging is the
-- standing consent a company gives once: two members may open an encrypted
-- connection without a reception link and a manual review for every pair.
--
-- Nothing here stores what an organization's agents are called or what they
-- do. The control plane knows who belongs and who is connected; the directory
-- of published agents is asked for over the encrypted connection itself.

ALTER TABLE spaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal' CHECK (
  kind IN ('personal', 'organization')
);

-- A personal space is named per owner. An organization is addressed by its
-- slug alone, so that slug is unique across the service while it is open.
CREATE UNIQUE INDEX one_open_organization_per_slug
ON spaces (slug)
WHERE kind = 'organization' AND status <> 'closed';

CREATE TRIGGER validate_organization_before_insert
BEFORE INSERT ON spaces
WHEN NEW.kind = 'organization'
BEGIN
  SELECT RAISE(ABORT, 'invalid_organization_slug') WHERE
    length(NEW.slug) NOT BETWEEN 3 AND 40
    OR NEW.slug GLOB '*[^a-z0-9-]*'
    OR NEW.slug GLOB '-*'
    OR NEW.slug GLOB '*-'
    OR NEW.slug = 'personal';
  SELECT RAISE(ABORT, 'organization_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM spaces
    WHERE owner_account_id = NEW.owner_account_id
      AND kind = 'organization' AND status <> 'closed'
  ) >= 3;
END;

-- Internal members were an entitlement the application counted. With a join
-- code two accounts can arrive at once, so the limit moves next to the row.
CREATE TRIGGER enforce_member_allowance_before_insert
BEFORE INSERT ON space_members
WHEN NEW.role IN ('owner', 'admin', 'member') AND NEW.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM space_members WHERE space_id = NEW.space_id AND account_id = NEW.account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'member_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM space_members
    WHERE space_id = NEW.space_id AND role IN ('owner', 'admin', 'member') AND status = 'active'
  ) >= 3
    + 7 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 9990 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');
END;

CREATE TRIGGER enforce_member_allowance_before_rejoin
BEFORE UPDATE OF status ON space_members
WHEN NEW.role IN ('owner', 'admin', 'member') AND NEW.status = 'active' AND OLD.status <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'member_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM space_members
    WHERE space_id = NEW.space_id AND role IN ('owner', 'admin', 'member') AND status = 'active'
  ) >= 3
    + 7 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 9990 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');
END;

-- A join code is shown once and stored as a hash. It carries no label: who it
-- was meant for is something the administrator knows, not the service.
CREATE TABLE organization_invitations (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_by_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'consumed', 'revoked', 'expired')
  ),
  use_limit INTEGER NOT NULL DEFAULT 1 CHECK (use_limit BETWEEN 1 AND 100),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND use_limit),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_organization_invitations_space
ON organization_invitations (space_id, status, expires_at);

CREATE TRIGGER validate_organization_invitation_before_insert
BEFORE INSERT ON organization_invitations
BEGIN
  SELECT RAISE(ABORT, 'organization_invitations_unavailable') WHERE NOT EXISTS (
    SELECT 1 FROM spaces s
    JOIN space_members m ON m.space_id = s.id
    WHERE s.id = NEW.space_id AND s.kind = 'organization' AND s.status = 'active'
      AND s.member_invites_enabled = 1
      AND m.account_id = NEW.created_by_account_id
      AND m.status = 'active' AND m.role IN ('owner', 'admin')
  );
  SELECT RAISE(ABORT, 'organization_invitation_allowance_exceeded') WHERE (
    SELECT COUNT(*) FROM organization_invitations
    WHERE space_id = NEW.space_id AND created_at >= datetime('now', '-1 day')
  ) >= 5
    + 95 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) IN ('company', 'custom'))
    + 9900 * ((SELECT plan_code FROM spaces WHERE id = NEW.space_id) = 'custom');
END;

CREATE TRIGGER prune_organization_invitations_after_insert
AFTER INSERT ON organization_invitations
BEGIN
  UPDATE organization_invitations
  SET status = 'expired'
  WHERE status = 'active' AND expires_at <= datetime('now');

  DELETE FROM organization_invitations
  WHERE status IN ('consumed', 'revoked', 'expired')
    AND created_at < datetime('now', '-30 days');
END;

-- One row per account that used a code. Inserting it is the atomic claim: the
-- insert only happens while a use is left, and it spends that use in the same
-- statement, so two accounts cannot both take the last one.
CREATE TABLE organization_invitation_claims (
  invitation_id TEXT NOT NULL REFERENCES organization_invitations(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL UNIQUE CHECK (length(claim_token) = 36),
  created_at TEXT NOT NULL,
  PRIMARY KEY (invitation_id, account_id)
);

CREATE TRIGGER spend_organization_invitation_after_claim
AFTER INSERT ON organization_invitation_claims
BEGIN
  UPDATE organization_invitations
  SET used_count = used_count + 1,
      status = CASE WHEN used_count + 1 >= use_limit THEN 'consumed' ELSE status END
  WHERE id = NEW.invitation_id;
END;

-- A connection request now has exactly one source of consent: a reception
-- link the recipient handed out, or an organization both accounts belong to.
ALTER TABLE connection_requests ADD COLUMN organization_id TEXT REFERENCES spaces(id) ON DELETE SET NULL;

DROP TRIGGER validate_connection_request_before_insert;

CREATE TRIGGER validate_connection_request_before_insert
BEFORE INSERT ON connection_requests
BEGIN
  SELECT RAISE(ABORT, 'connection_consent_source_conflict') WHERE
    NEW.organization_id IS NOT NULL AND NEW.reception_link_id IS NOT NULL;
  SELECT RAISE(ABORT, 'reception_link_unavailable') WHERE
    NEW.organization_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM reception_links
      WHERE id = NEW.reception_link_id
        AND owner_account_id = NEW.target_account_id
        AND status = 'active'
        AND used_count < request_limit
        AND expires_at > datetime('now')
    );
  SELECT RAISE(ABORT, 'organization_membership_required') WHERE
    NEW.organization_id IS NOT NULL AND (
      NOT EXISTS (
        SELECT 1 FROM spaces
        WHERE id = NEW.organization_id AND kind = 'organization' AND status = 'active'
      )
      OR (
        SELECT COUNT(*) FROM space_members
        WHERE space_id = NEW.organization_id
          AND status = 'active' AND role IN ('owner', 'admin', 'member')
          AND account_id IN (NEW.target_account_id, NEW.requester_account_id)
      ) <> 2
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

PRAGMA foreign_key_check;
