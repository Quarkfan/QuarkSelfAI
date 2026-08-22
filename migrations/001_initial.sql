BEGIN;

CREATE TABLE IF NOT EXISTS assistant_event (
  id uuid PRIMARY KEY,
  event_key text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  source jsonb NOT NULL,
  payload jsonb NOT NULL,
  raw jsonb NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_event_received_at_idx
  ON assistant_event (received_at DESC);

CREATE TABLE IF NOT EXISTS matter (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('open', 'waiting', 'completed', 'ignored', 'superseded')),
  title text NOT NULL,
  latest_summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_record (
  id uuid PRIMARY KEY,
  matter_id uuid NOT NULL REFERENCES matter(id),
  state text NOT NULL CHECK (state IN (
    'observed', 'settling', 'planned', 'awaiting-approval', 'executing',
    'waiting-external', 'completed', 'superseded', 'failed'
  )),
  intent text NOT NULL,
  source jsonb NOT NULL,
  executor text CHECK (executor IN ('claude-code', 'codex', 'dsh-native')),
  approval_id uuid,
  supersedes uuid REFERENCES action_record(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_record_matter_updated_idx
  ON action_record (matter_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS action_transition (
  id bigserial PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES action_record(id),
  from_state text,
  to_state text NOT NULL,
  reason text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_request (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES action_record(id),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  prompt text NOT NULL,
  decision jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_request_one_pending_per_action
  ON approval_request (action_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS projection_binding (
  id bigserial PRIMARY KEY,
  projection_kind text NOT NULL,
  external_id text NOT NULL,
  matter_id uuid REFERENCES matter(id),
  action_id uuid REFERENCES action_record(id),
  content_fingerprint text NOT NULL DEFAULT '',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  CHECK (matter_id IS NOT NULL OR action_id IS NOT NULL),
  UNIQUE (projection_kind, external_id)
);

CREATE TABLE IF NOT EXISTS consumer_checkpoint (
  consumer_name text NOT NULL,
  event_key text NOT NULL,
  cursor jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_key)
);

COMMIT;
