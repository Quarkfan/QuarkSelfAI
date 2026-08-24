PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE action_record_open (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matter(id),
  state TEXT NOT NULL CHECK (state IN (
    'observed', 'settling', 'planned', 'awaiting-approval', 'executing',
    'waiting-external', 'completed', 'superseded', 'failed'
  )),
  intent TEXT NOT NULL,
  source TEXT NOT NULL CHECK (json_valid(source)),
  executor TEXT,
  approval_id TEXT,
  supersedes TEXT REFERENCES action_record_open(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO action_record_open
  (id, matter_id, state, intent, source, executor, approval_id, supersedes, created_at, updated_at)
SELECT id, matter_id, state, intent, source, executor, approval_id, supersedes, created_at, updated_at
FROM action_record;

DROP TABLE action_record;
ALTER TABLE action_record_open RENAME TO action_record;
CREATE INDEX action_record_matter_updated_idx ON action_record (matter_id, updated_at DESC);

CREATE TABLE action_execution_open (
  action_id TEXT PRIMARY KEY REFERENCES action_record(id),
  request TEXT NOT NULL CHECK (json_valid(request)),
  requested_executor TEXT,
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

INSERT INTO action_execution_open
  (action_id, request, requested_executor, status, lease_owner, lease_expires_at, attempt, available_at, result, last_error, created_at, updated_at)
SELECT action_id, request, requested_executor, status, lease_owner, lease_expires_at, attempt, available_at, result, last_error, created_at, updated_at
FROM action_execution;

DROP TABLE action_execution;
ALTER TABLE action_execution_open RENAME TO action_execution;
CREATE INDEX action_execution_claim_idx ON action_execution (status, available_at, lease_expires_at);

COMMIT;
PRAGMA foreign_keys = ON;
