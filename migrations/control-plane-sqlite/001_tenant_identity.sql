PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cp_tenant (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('test', 'active', 'suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_user (
  tenant_id TEXT NOT NULL REFERENCES cp_tenant(tenant_id),
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS cp_device (
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'registered', 'revoked')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, device_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES cp_user(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS cp_device_owner_idx ON cp_device (tenant_id, user_id, device_id);
