BEGIN;

CREATE TABLE IF NOT EXISTS policy_definition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'enabled', 'disabled')),
  active_revision INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS policy_revision (
  policy_id TEXT NOT NULL REFERENCES policy_definition(id),
  revision INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  compiled TEXT NOT NULL CHECK (json_valid(compiled)),
  simulation TEXT NOT NULL CHECK (json_valid(simulation)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  approved_at TEXT,
  PRIMARY KEY (policy_id, revision)
);

CREATE INDEX IF NOT EXISTS policy_definition_status_updated_idx
  ON policy_definition (status, updated_at DESC);

COMMIT;
