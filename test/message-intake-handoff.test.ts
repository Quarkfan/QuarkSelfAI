import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareMessageIntakeHandoff } from '../src/migration/message-intake-handoff.js'

test('message intake handoff is content addressed and reports every owned queue', () => {
  const state = { mentionPending: [{ message: { message_id: 'om-1', content: 'secret' } }], processedCardEventIds: ['evt-1'], reactionStates: { one: { emoji: 'OK' } }, flaggedConversationChatIds: ['oc-1'] }
  const first = prepareMessageIntakeHandoff(state, '2026-08-24T00:00:00Z')
  const repeat = prepareMessageIntakeHandoff(state, '2026-08-24T00:00:00Z')
  assert.equal(first.digest, repeat.digest)
  assert.equal(first.counts.mentionPending, 1)
  assert.equal(first.counts.processedCardEventIds, 1)
  assert.equal(first.counts.reactionStates, 1)
  assert.equal(JSON.stringify(first).includes('secret'), false)
  assert.notEqual(first.digest, prepareMessageIntakeHandoff({ ...state, mentionPending: [] }, '2026-08-24T00:00:00Z').digest)
})
