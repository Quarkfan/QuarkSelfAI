PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cp_agent_draft (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  blueprint_json TEXT NOT NULL,
  blueprint_digest TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (state IN ('draft', 'test-released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, draft_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES cp_user(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS cp_agent_test_release (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  version TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  blueprint_digest TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, blueprint_id, version),
  FOREIGN KEY (tenant_id, user_id, draft_id) REFERENCES cp_agent_draft(tenant_id, user_id, draft_id)
);

CREATE INDEX IF NOT EXISTS cp_agent_draft_owner_idx ON cp_agent_draft (tenant_id, user_id, updated_at, draft_id);
