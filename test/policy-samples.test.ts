import assert from 'node:assert/strict'
import test from 'node:test'
import { eventToPolicySample } from '../src/collaboration/policy-samples.js'

test('policy samples consume only channel-neutral text', () => {
  const sample = eventToPolicySample({
    id: 'event:one',
    source: { containerId: 'conversation:one', actorId: 'person:one' },
    payload: { text: '明天完成', chatType: 'group', content: JSON.stringify({ text: 'wrong protocol value' }) },
  })
  assert.deepEqual(sample.facts, {
    channel: { chatType: 'group' },
    source: { chatId: 'conversation:one', senderId: 'person:one' },
    message: { text: '明天完成', hasDeadline: true },
  })
})

test('policy samples do not parse a channel adapter raw content envelope', () => {
  const sample = eventToPolicySample({
    id: 'event:raw-only',
    source: {},
    payload: { content: JSON.stringify({ text: 'adapter-specific' }) },
  })
  assert.deepEqual(sample.facts, { channel: {}, source: {}, message: {} })
})
