BEGIN;

CREATE TABLE IF NOT EXISTS workflow_instance (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'waiting', 'completed', 'failed')),
  state TEXT NOT NULL CHECK (json_valid(state)),
  revision INTEGER NOT NULL DEFAULT 0,
  wake_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS workflow_instance_due_idx ON workflow_instance (status, wake_at);

CREATE TABLE IF NOT EXISTS workflow_event (
  instance_id TEXT NOT NULL REFERENCES workflow_instance(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  processed_revision INTEGER NOT NULL,
  PRIMARY KEY (instance_id, event_id)
);

CREATE TABLE IF NOT EXISTS workflow_transition (
  instance_id TEXT NOT NULL REFERENCES workflow_instance(id),
  revision INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  state TEXT NOT NULL CHECK (json_valid(state)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (instance_id, revision)
);

CREATE TABLE IF NOT EXISTS workflow_effect (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES workflow_instance(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatching', 'delivered', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS workflow_effect_claim_idx ON workflow_effect (status, available_at, lease_expires_at);

COMMIT;
