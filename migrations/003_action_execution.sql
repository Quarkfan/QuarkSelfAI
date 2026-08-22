BEGIN;

CREATE TABLE IF NOT EXISTS action_execution (
  action_id uuid PRIMARY KEY REFERENCES action_record(id),
  request jsonb NOT NULL,
  requested_executor text CHECK (requested_executor IN ('claude-code', 'codex', 'dsh-native')),
  status text NOT NULL CHECK (status IN ('pending', 'executing', 'completed', 'needs-input', 'failed')),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_execution_claim_idx
  ON action_execution (status, available_at, lease_expires_at);

COMMIT;
