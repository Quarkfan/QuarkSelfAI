BEGIN;

CREATE TABLE IF NOT EXISTS assistant_signal (
  id text PRIMARY KEY,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_signal_kind_occurred_idx
  ON assistant_signal (kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS feature_checkpoint (
  namespace text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key)
);

COMMIT;
