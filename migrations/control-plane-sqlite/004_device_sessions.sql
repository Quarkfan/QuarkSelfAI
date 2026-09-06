PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cp_device_challenge (
  challenge_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (tenant_id, device_id) REFERENCES cp_device(tenant_id, device_id)
);

CREATE TABLE IF NOT EXISTS cp_device_session (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'superseded', 'expired', 'revoked')),
  FOREIGN KEY (tenant_id, device_id) REFERENCES cp_device(tenant_id, device_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cp_device_one_active_session
  ON cp_device_session (tenant_id, device_id) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS cp_device_dispatch (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'completed', 'failed', 'cancelled')),
  created_at TEXT NOT NULL,
  lease_token TEXT,
  lease_attempt INTEGER NOT NULL DEFAULT 0 CHECK (lease_attempt >= 0),
  leased_at TEXT,
  lease_expires_at TEXT,
  acknowledged_at TEXT,
  PRIMARY KEY (tenant_id, task_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, device_id) REFERENCES cp_device(tenant_id, device_id)
);

CREATE TABLE IF NOT EXISTS cp_device_result (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, task_id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES cp_device_dispatch(tenant_id, task_id)
);

CREATE INDEX IF NOT EXISTS cp_device_dispatch_poll
  ON cp_device_dispatch (tenant_id, user_id, device_id, state, created_at, task_id);
