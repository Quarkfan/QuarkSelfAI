PRAGMA foreign_keys = ON;
BEGIN;
CREATE TABLE IF NOT EXISTS event_delivery (
  consumer_name TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES assistant_event(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  worker_id TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (consumer_name, event_id)
);
CREATE INDEX IF NOT EXISTS event_delivery_claim_idx ON event_delivery (consumer_name, status, available_at, lease_expires_at);
COMMIT;
