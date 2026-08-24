BEGIN;
CREATE TABLE IF NOT EXISTS event_delivery (
  consumer_name text NOT NULL,
  event_id text NOT NULL REFERENCES assistant_event(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  worker_id text,
  lease_expires_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);
CREATE INDEX IF NOT EXISTS event_delivery_claim_idx ON event_delivery (consumer_name, status, available_at, lease_expires_at);
COMMIT;
