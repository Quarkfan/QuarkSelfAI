PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS cp_device_enrollment (
  request_id TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  poll_token_digest TEXT NOT NULL,
  tenant_hint TEXT NOT NULL,
  user_hint TEXT NOT NULL,
  device_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approving', 'approved', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decision_started_at TEXT,
  approved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS cp_device_enrollment_pending_idx
  ON cp_device_enrollment (tenant_hint, user_hint, device_id)
  WHERE state IN ('pending', 'approving');
