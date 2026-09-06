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
