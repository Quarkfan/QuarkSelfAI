PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_device_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  identity_json TEXT NOT NULL,
  private_key_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_workspace (
  handle TEXT PRIMARY KEY,
  canonical_root TEXT NOT NULL UNIQUE,
  access TEXT NOT NULL CHECK (access IN ('read', 'read-write')),
  grant_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_executor_report (
  executor_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_capability_state (
  capability_id TEXT NOT NULL,
  version TEXT NOT NULL,
  device_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (capability_id, version)
);

CREATE TABLE IF NOT EXISTS local_capability_selection (
  capability_id TEXT PRIMARY KEY,
  current_version TEXT NOT NULL,
  previous_version TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (capability_id, current_version) REFERENCES local_capability_state(capability_id, version),
  FOREIGN KEY (capability_id, previous_version) REFERENCES local_capability_state(capability_id, version)
);

CREATE TABLE IF NOT EXISTS local_run_checkpoint (
  task_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  checkpoint_digest TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_device_enrollment (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  request_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  user_code TEXT NOT NULL,
  poll_token_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved-cleanup-pending', 'approved', 'expired-cleanup-pending', 'expired')),
  expires_at TEXT NOT NULL,
  poll_after_seconds INTEGER NOT NULL CHECK (poll_after_seconds = 5),
  updated_at TEXT NOT NULL
);

-- Client-local Matter truth for a future no-Dida intake provider. Never an action-worker queue.
CREATE TABLE IF NOT EXISTS local_matter (
  matter_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'waiting', 'completed', 'ignored', 'superseded')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority IN (1, 3, 5)),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, user_id, source_fingerprint)
);

CREATE TABLE IF NOT EXISTS local_matter_intake (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  matter_id TEXT NOT NULL REFERENCES local_matter(matter_id),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, idempotency_fingerprint)
);
