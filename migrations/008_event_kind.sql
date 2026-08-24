BEGIN;

ALTER TABLE assistant_event
  ADD COLUMN kind text NOT NULL DEFAULT 'channel.event';

UPDATE assistant_event SET kind = 'message.received' WHERE event_key = 'im.message.receive_v1';
UPDATE assistant_event SET kind = 'card.action' WHERE event_key = 'card.action.trigger';

CREATE INDEX assistant_event_kind_received_idx ON assistant_event (kind, received_at DESC);

COMMIT;
