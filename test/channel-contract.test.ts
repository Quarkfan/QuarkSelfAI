import assert from 'node:assert/strict'
import test from 'node:test'
import { eventRecordId, validateNormalizedChannelEvent, type NormalizedChannelEvent } from '../src/domain/channel.js'

const calendarEvent: NormalizedChannelEvent = {
  kind: 'calendar.changed',
  source: { channel: 'calendar-provider', containerId: 'team-calendar', resourceId: 'event-1', actorId: 'person-1' },
  occurredAt: '2026-08-25T00:00:00Z',
  eventKey: 'calendar.changed.v1',
  deduplicationKey: 'event-1:revision-2',
  payload: { revision: 2, attendees: ['person-1'] },
  raw: { id: 'event-1', revision: 2 },
}

test('channel skeleton accepts a provider-neutral, replay-safe event envelope', () => {
  assert.doesNotThrow(() => validateNormalizedChannelEvent(calendarEvent))
  assert.equal(eventRecordId(calendarEvent), 'event:calendar-provider:event-1:revision-2')
})

test('channel skeleton rejects unstable or incomplete durable envelopes', () => {
  assert.throws(() => validateNormalizedChannelEvent({ ...calendarEvent, source: { channel: '' } }), /source channel/)
  assert.throws(() => validateNormalizedChannelEvent({ ...calendarEvent, occurredAt: 'not-a-time' }), /occurredAt/)
  assert.throws(() => validateNormalizedChannelEvent({
    ...calendarEvent, payload: { absent: undefined },
  }), /non-JSON value/)
  assert.throws(() => validateNormalizedChannelEvent({
    ...calendarEvent, raw: { generatedAt: new Date() },
  }), /non-plain object/)
})
