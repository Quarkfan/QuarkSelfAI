PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE IF NOT EXISTS assistant_event (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  deduplication_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (json_valid(source)),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  raw TEXT NOT NULL CHECK (json_valid(raw)),
  occurred_at TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS assistant_event_received_at_idx
  ON assistant_event (received_at DESC);

CREATE TABLE IF NOT EXISTS matter (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open', 'waiting', 'completed', 'ignored', 'superseded')),
  title TEXT NOT NULL,
  latest_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS action_record (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matter(id),
  state TEXT NOT NULL CHECK (state IN (
    'observed', 'settling', 'planned', 'awaiting-approval', 'executing',
    'waiting-external', 'completed', 'superseded', 'failed'
  )),
  intent TEXT NOT NULL,
  source TEXT NOT NULL CHECK (json_valid(source)),
  executor TEXT CHECK (executor IN ('claude-code', 'codex', 'dsh-native')),
  approval_id TEXT,
  supersedes TEXT REFERENCES action_record(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS action_record_matter_updated_idx
  ON action_record (matter_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS action_transition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL REFERENCES action_record(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS approval_request (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES action_record(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  prompt TEXT NOT NULL,
  decision TEXT CHECK (decision IS NULL OR json_valid(decision)),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_request_one_pending_per_action
  ON approval_request (action_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS projection_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projection_kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  matter_id TEXT REFERENCES matter(id),
  action_id TEXT REFERENCES action_record(id),
  content_fingerprint TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (matter_id IS NOT NULL OR action_id IS NOT NULL),
  UNIQUE (projection_kind, external_id)
);

CREATE TABLE IF NOT EXISTS consumer_checkpoint (
  consumer_name TEXT NOT NULL,
  event_key TEXT NOT NULL,
  cursor TEXT NOT NULL CHECK (json_valid(cursor)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (consumer_name, event_key)
);

COMMIT;
