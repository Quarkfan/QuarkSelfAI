BEGIN;

CREATE TABLE IF NOT EXISTS action_execution (
  action_id TEXT PRIMARY KEY REFERENCES action_record(id),
  request TEXT NOT NULL CHECK (json_valid(request)),
  requested_executor TEXT CHECK (requested_executor IN ('claude-code', 'codex', 'dsh-native')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'completed', 'needs-input', 'failed')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS action_execution_claim_idx
  ON action_execution (status, available_at, lease_expires_at);

COMMIT;
