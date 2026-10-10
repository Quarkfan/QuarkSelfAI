import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMessageIntakeHandoff, prepareMessageIntakeHandoff } from '../src/migration/message-intake-handoff.js'

test('message intake handoff imports pending messages idempotently without exposing them from the audit', async () => {
  const state = {
    mentionPending: [{ message: { message_id: 'om-1', chat_id: 'oc-1', create_time: '2026-08-23T23:00:00Z', content: 'synthetic pending message', sender: { id: 'ou-1' } } }],
    reactionPendingEvents: [{ eventId: 'evt-reaction-1', operation: 'created', messageId: 'om-target', operatorId: 'ou-1', operatorType: 'user', emojiType: 'OK', occurredAt: '2026-08-23T23:01:00Z' }],
    notificationDigestPending: [{ messageId: 'om-digest-1', taskId: 'task-1', title: 'Synthetic update', materialChange: 'Changed', nextAction: '', source: 'Synthetic source', sender: 'Synthetic sender', url: null, queuedAt: '2026-08-23T23:02:00Z', ownerMessage: 'Review later', notificationTitle: '', deliverAfter: '2026-08-24T00:02:00Z' }],
    processedCardEventIds: ['evt-1'], reactionStates: { one: { emoji: 'OK' } }, flaggedConversationChatIds: ['oc-1'],
  }
  const first = prepareMessageIntakeHandoff(state, '2026-08-24T00:00:00Z')
  const repeat = prepareMessageIntakeHandoff(state, '2026-08-24T00:00:00Z')
  assert.equal(first.digest, repeat.digest)
  assert.equal(first.counts.mentionPending, 1)
  assert.equal(first.counts.processedCardEventIds, 1)
  assert.equal(first.counts.reactionStates, 1)
  assert.equal(first.pendingEvents[0]?.payload.text, 'synthetic pending message')
  assert.equal(first.pendingEvents[1]?.eventKey, 'quark.migration.feishu-reaction.v1')
  assert.equal(first.pendingWorkflows.length, 1)
  assert.notEqual(first.digest, prepareMessageIntakeHandoff({ ...state, mentionPending: [] }, '2026-08-24T00:00:00Z').digest)
  const events = new Set<string>(); const workflows = new Set<string>(); const checkpoints = new Map<string, Readonly<Record<string, unknown>>>()
  const target = {
    async appendEvent(id: string) { const inserted = !events.has(id); events.add(id); return { inserted } },
    async createWorkflow(input: { id: string }) { const inserted = !workflows.has(input.id); workflows.add(input.id); return { inserted } },
    async readFeatureCheckpoint(namespace: string, key: string) { return checkpoints.get(`${namespace}:${key}`) },
    async writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>) { checkpoints.set(`${namespace}:${key}`, value) },
  }
  assert.deepEqual(await applyMessageIntakeHandoff(target, first, first.digest), { insertedEvents: 2, existingEvents: 0, insertedWorkflows: 1, existingWorkflows: 0, writtenCheckpoint: 1 })
  assert.deepEqual(await applyMessageIntakeHandoff(target, first, first.digest), { insertedEvents: 0, existingEvents: 2, insertedWorkflows: 0, existingWorkflows: 1, writtenCheckpoint: 0 })
  await assert.rejects(applyMessageIntakeHandoff(target, first, 'wrong'), /digest changed/)
})
