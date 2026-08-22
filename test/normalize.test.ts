import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLarkEvent } from '../src/lark/normalize.js'

test('normalizes messages and preserves newly introduced fields', () => {
  const raw = {
    event_id: 'evt-1',
    message_id: 'om-1',
    chat_id: 'oc-1',
    sender_id: 'ou-1',
    content: 'hello',
    timestamp: '1787390310000',
    future_cli_field: { value: 42 },
  }
  const event = normalizeLarkEvent('im.message.receive_v1', raw)
  assert.equal(event.kind, 'message.received')
  assert.equal(event.deduplicationKey, 'om-1')
  assert.equal(event.occurredAt, '2026-08-22T09:18:30.000Z')
  assert.deepEqual(event.raw.future_cli_field, { value: 42 })
})

test('passes an unknown event through instead of discarding it', () => {
  const event = normalizeLarkEvent('calendar.new_feature_v1', { event_id: 'evt-new', value: true })
  assert.equal(event.kind, 'lark.event')
  assert.equal(event.deduplicationKey, 'evt-new')
  assert.equal(event.payload.value, true)
})
