import assert from 'node:assert/strict'
import test from 'node:test'
import { auditLegacyState } from '../src/migration/legacy-state-audit.js'

test('preserves pending jobs and health state as resumable handoff data without exposing content', () => {
  const report = auditLegacyState({
    queue: [{ id: 'job-1', sessionId: 'session-1', prompt: 'sensitive text' }],
    mentionPending: [],
    mentionHealthFailure: { at: '2026-08-22T10:00:00.000Z', error: 'network details' },
    processedMessageIds: ['message-1'],
  })
  assert.equal(report.handoffSafe, true)
  assert.deepEqual(report.blockers, [])
  assert.deepEqual(report.warnings, [{ code: 'active-health-failure', count: 1 }])
  assert.equal(report.transferableWork.queuedControllerWork, 1)
  assert.equal(JSON.stringify(report).includes('sensitive text'), false)
})

test('blocks malformed or duplicate state that cannot be resumed deterministically', () => {
  const report = auditLegacyState({
    queue: [{ id: 'job-1' }, { id: 'job-1', sessionId: 'session-1', prompt: 'work' }],
    processedMessageIds: ['message-1', 'message-1'],
  })
  assert.equal(report.handoffSafe, false)
  assert.deepEqual(report.blockers, [
    { code: 'malformed-queued-job', count: 1 },
    { code: 'duplicate-state-id', count: 2 },
  ])
})

test('accepts a quiescent state checkpoint', () => {
  const report = auditLegacyState({
    queue: [], mentionPending: [], mentionResearchConfirmations: [], xiaoweiResearchRequests: [],
    followupOutreachRequests: [], processedMessageIds: ['message-1'],
  })
  assert.equal(report.handoffSafe, true)
  assert.deepEqual(report.blockers, [])
})
