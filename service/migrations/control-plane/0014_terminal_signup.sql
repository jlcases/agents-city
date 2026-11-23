-- Accounts made from a terminal, on a service that has no website.
--
-- An account made this way has no passkey: until its computer finishes
-- registering it has nothing at all. This table is how such an account is
-- told apart from every other, so one that never got its computer can be
-- cleared away without touching an account anybody could be using.
CREATE TABLE terminal_enrollments (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  grant_kind TEXT NOT NULL CHECK (grant_kind IN ('bootstrap', 'join_code')),
  created_at TEXT NOT NULL
);

-- The operator's secret makes one account, once. "No account exists" is not
-- that: accounts can be deleted, and the secret must not come back to life the
-- day the last one is. This row is written with the first account and outlives
-- it.
CREATE TABLE service_bootstrap (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  consumed_at TEXT NOT NULL
);
