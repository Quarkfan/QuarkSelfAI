BEGIN;

CREATE TABLE IF NOT EXISTS workflow_instance (
  id text PRIMARY KEY,
  kind text NOT NULL,
  definition_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'waiting', 'completed', 'failed')),
  state jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  wake_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_instance_due_idx ON workflow_instance (status, wake_at);

CREATE TABLE IF NOT EXISTS workflow_event (
  instance_id text NOT NULL REFERENCES workflow_instance(id),
  event_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  processed_revision integer NOT NULL,
  PRIMARY KEY (instance_id, event_id)
);

CREATE TABLE IF NOT EXISTS workflow_transition (
  instance_id text NOT NULL REFERENCES workflow_instance(id),
  revision integer NOT NULL,
  event_id text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, revision)
);

CREATE TABLE IF NOT EXISTS workflow_effect (
  id text PRIMARY KEY,
  instance_id text NOT NULL REFERENCES workflow_instance(id),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatching', 'delivered', 'failed')),
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_effect_claim_idx ON workflow_effect (status, available_at, lease_expires_at);

COMMIT;
