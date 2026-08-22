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

test('reports privacy-safe operational evidence for takeover decisions', () => {
  const report = auditLegacyState({
    controllerSessionId: 'controller', currentSessionId: 'current', queue: [],
    processedMessageIds: ['owner-1'], processedCardEventIds: ['card-1'],
    overdueNotified: { fingerprint: 'timestamp' },
    didaCompletedCleanupLastAt: '2026-08-22T01:00:00.000Z',
    followupLastCheckedAt: '2026-08-22T02:00:00.000Z',
    mentionResearchSessions: [{
      sessionId: 'session', archivedAt: '2026-08-10T00:00:00.000Z', deletedAt: '2026-08-18T00:00:00.000Z',
      archiveFailureCount: 0, deleteFailureCount: 0,
    }],
    xiaoweiResearchRequests: [{ status: 'completed', replyMessageId: 'reply', replyContent: 'sensitive' }],
  })
  assert.deepEqual(report.operationalEvidence, {
    controllerSessionPresent: true,
    currentSessionPresent: true,
    activeHealthFailures: 0,
    overdueFingerprints: 1,
    completedCleanupHasRun: true,
    workdayFollowupHasRun: true,
    archivedResearchSessions: 1,
    deletedResearchSessions: 1,
    researchSessionFailures: 0,
    completedXiaoweiRequests: 1,
    xiaoweiRepliesCorrelated: 1,
  })
  assert.equal(JSON.stringify(report).includes('sensitive'), false)
})
