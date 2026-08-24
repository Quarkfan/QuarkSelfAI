import assert from 'node:assert/strict'
import test from 'node:test'
import { focusDiscoveryWorkflow } from '../src/intake/discovery-workflow.js'
import { INTAKE_EFFECTS } from '../src/intake/types.js'

const sources = {
  ownerOpenId: 'ou_owner', senderIds: ['ou_focus'], conversationIds: ['oc_focus'],
  includeOwnerParticipation: true, includeFlaggedConversations: true, includeDirectMessages: true,
  includeMentionBackfill: true, feedGroupNames: ['特别关注'],
}

test('focus discovery is a durable ten-minute workflow with an overlap window', () => {
  const workflow = focusDiscoveryWorkflow()
  const initial = workflow.initialize({ intervalMs: 600_000, overlapMs: 120_000, retryMs: 600_000, sources }, '2026-08-24T00:10:00.000Z')
  assert.equal(initial.wakeAt, '2026-08-24T00:10:00.000Z')
  const running = workflow.reduce(initial.state, { id: 'timer', type: 'timer', occurredAt: '2026-08-24T00:10:00.000Z', payload: {} })
  assert.equal(running.effects?.[0]?.kind, INTAKE_EFFECTS.discoverSignals)
  assert.deepEqual(running.effects?.[0]?.payload, {
    from: '2026-08-23T23:58:00.000Z', until: '2026-08-24T00:10:00.000Z', sources,
  })
  assert.equal(running.wakeAt, null)
  const scheduled = workflow.reduce(running.state, {
    id: 'delivered', type: 'effect.delivered', occurredAt: '2026-08-24T00:10:05.000Z',
    payload: { effectKind: INTAKE_EFFECTS.discoverSignals, effectId: running.effects![0]!.id },
  })
  assert.equal(scheduled.wakeAt, '2026-08-24T00:20:05.000Z')
  assert.equal(scheduled.state.lastSuccessfulAt, '2026-08-24T00:10:00.000Z')
})

test('focus discovery refuses high-frequency polling and durably retries terminal failures', () => {
  const workflow = focusDiscoveryWorkflow()
  assert.throws(() => workflow.initialize({ intervalMs: 599_999, sources }, '2026-08-24T00:00:00Z'), />= 600000/)
  const initial = workflow.initialize({ intervalMs: 600_000, retryMs: 600_000, sources }, '2026-08-24T00:00:00.000Z')
  const running = workflow.reduce(initial.state, { id: 'timer', type: 'timer', occurredAt: '2026-08-24T00:00:00.000Z', payload: {} })
  const retry = workflow.reduce(running.state, {
    id: 'failed', type: 'effect.failed', occurredAt: '2026-08-24T00:01:00.000Z',
    payload: { effectKind: INTAKE_EFFECTS.discoverSignals, effectId: running.effects![0]!.id, error: 'timeout' },
  })
  assert.equal(retry.wakeAt, '2026-08-24T00:11:00.000Z')
  assert.equal(retry.state.consecutiveFailures, 1)
})
