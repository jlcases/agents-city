-- Consent in the hosted control plane is identity and state only. Remove the
-- legacy columns entirely so neither a current nor an older caller can place
-- a human-written label, introduction, or rejection reason in D1.

DROP TRIGGER IF EXISTS enforce_private_connection_content_before_insert;
DROP TRIGGER IF EXISTS enforce_private_connection_content_before_update;

ALTER TABLE reception_links DROP COLUMN label;
ALTER TABLE connection_requests DROP COLUMN intro_text;
ALTER TABLE connection_requests DROP COLUMN rejection_reason;

PRAGMA foreign_key_check;
