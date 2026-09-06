PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cp_identity_admin_audit (
  tenant_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('account.provision')),
  roles_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, audit_id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES cp_user(tenant_id, user_id),
  FOREIGN KEY (tenant_id, target_user_id) REFERENCES cp_user(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS cp_identity_admin_audit_time_idx ON cp_identity_admin_audit (tenant_id, occurred_at, audit_id);
