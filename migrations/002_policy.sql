BEGIN;

CREATE TABLE IF NOT EXISTS policy_definition (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'enabled', 'disabled')),
  active_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_revision (
  policy_id uuid NOT NULL REFERENCES policy_definition(id),
  revision integer NOT NULL,
  source_text text NOT NULL,
  compiled jsonb NOT NULL,
  simulation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  PRIMARY KEY (policy_id, revision)
);

CREATE INDEX IF NOT EXISTS policy_definition_status_updated_idx
  ON policy_definition (status, updated_at DESC);

COMMIT;
