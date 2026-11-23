CREATE TABLE key_transparency_roots (
  version INTEGER PRIMARY KEY CHECK (version >= 1),
  root_hash TEXT NOT NULL UNIQUE CHECK (length(root_hash) = 43),
  root_json TEXT NOT NULL CHECK (length(root_json) BETWEEN 256 AND 65536),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at),
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_key_transparency_roots_expiry
ON key_transparency_roots(expires_at, version);
