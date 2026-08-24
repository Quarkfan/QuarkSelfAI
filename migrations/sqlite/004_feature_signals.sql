BEGIN;

CREATE TABLE IF NOT EXISTS assistant_signal (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope)),
  data TEXT NOT NULL CHECK (json_valid(data)),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS assistant_signal_kind_occurred_idx
  ON assistant_signal (kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS feature_checkpoint (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, key)
);

COMMIT;
