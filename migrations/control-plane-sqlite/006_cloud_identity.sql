PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cp_auth_account (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  password_salt BLOB NOT NULL,
  password_hash BLOB NOT NULL,
  roles_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES cp_user(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS cp_browser_session (
  session_digest TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked', 'expired')),
  FOREIGN KEY (tenant_id, user_id) REFERENCES cp_auth_account(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS cp_browser_session_owner_idx ON cp_browser_session (tenant_id, user_id, state, expires_at);

CREATE TABLE IF NOT EXISTS cp_auth_throttle (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
  blocked_until TEXT,
  PRIMARY KEY (tenant_id, user_id)
);
