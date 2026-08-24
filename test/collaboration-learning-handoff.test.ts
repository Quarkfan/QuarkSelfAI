import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCollaborationLearningHandoff, prepareCollaborationLearningHandoff } from '../src/migration/collaboration-learning-handoff.js'

test('prepares a privacy-bounded content-addressed collaboration handoff', () => {
  const state = { collaborationLearning: {
    observations: [{ at: '2026-08-23T00:00:00Z', messageId: 'om_1', chatId: 'oc_1', content: 'must not migrate', difference: 'could_batch', intakeReasons: [] }],
    ownerSignals: [{ at: '2026-08-23T01:00:00Z', type: 'direct_message', messageId: 'om_owner', correctionCue: true }],
    candidates: [{ proposedAt: '2026-08-23T02:00:00Z', policyId: 'policy-1', scopeKey: 'chat:oc_1', status: 'proposed' }],
    lastEvaluatedAt: '2026-08-23T03:00:00Z', lastProposalAt: '2026-08-23T02:00:00Z',
  } }
  const first = prepareCollaborationLearningHandoff(state)
  const second = prepareCollaborationLearningHandoff(state)
  assert.deepEqual(first.counts, { observations: 1, ownerSignals: 1, candidates: 1 })
  assert.equal(first.digest, second.digest)
  assert.equal(first.signals.some(signal => 'content' in signal.data), false)
  assert.deepEqual(Object.keys(first.checkpoints).sort(), ['evaluation', 'proposal'])
})

test('rejects malformed legacy collaboration state instead of silently dropping it', () => {
  assert.throws(() => prepareCollaborationLearningHandoff({
    collaborationLearning: { observations: [{ at: 'not-a-date' }] },
  }), /messageId/)
})

test('imports an audited handoff idempotently and never overwrites a native checkpoint', async () => {
  const handoff = prepareCollaborationLearningHandoff({ collaborationLearning: {
    observations: [{ at: '2026-08-23T00:00:00Z', messageId: 'om_1', intakeReasons: [] }],
    lastEvaluatedAt: '2026-08-23T03:00:00Z',
  } })
  const ids = new Set<string>()
  const checkpoints = new Map<string, Readonly<Record<string, unknown>>>()
  const target = {
    async appendSignal(input: { id: string }) { const inserted = !ids.has(input.id); ids.add(input.id); return { inserted } },
    async readFeatureCheckpoint(namespace: string, key: string) { return checkpoints.get(`${namespace}:${key}`) },
    async writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>) { checkpoints.set(`${namespace}:${key}`, value) },
  }
  assert.deepEqual(await applyCollaborationLearningHandoff(target, handoff, handoff.digest), {
    insertedSignals: 1, existingSignals: 0, writtenCheckpoints: 1,
  })
  assert.deepEqual(await applyCollaborationLearningHandoff(target, handoff, handoff.digest), {
    insertedSignals: 0, existingSignals: 1, writtenCheckpoints: 0,
  })
  checkpoints.set('collaboration-learning:evaluation', { lastEvaluatedAt: '2026-08-24T00:00:00Z' })
  await assert.rejects(applyCollaborationLearningHandoff(target, handoff, handoff.digest), /already has different content/)
  await assert.rejects(applyCollaborationLearningHandoff(target, handoff, 'wrong'), /digest changed/)
})
