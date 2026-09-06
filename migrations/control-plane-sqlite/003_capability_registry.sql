PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cp_capability_release (
  tenant_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  version TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  evidence_policy_revision TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'tenant')),
  state TEXT NOT NULL CHECK (state = 'catalogued-inactive'),
  registered_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, capability_id, version),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES cp_user(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS cp_capability_visibility_idx
  ON cp_capability_release (tenant_id, visibility, owner_user_id, capability_id, version);
