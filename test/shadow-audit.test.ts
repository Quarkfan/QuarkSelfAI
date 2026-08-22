import assert from 'node:assert/strict'
import test from 'node:test'
import { auditShadowState } from '../src/migration/shadow-audit.js'

function decision(messageId: string) {
  return {
    messageId,
    matterKey: `matter-${messageId}`,
    at: '2026-08-21T00:00:00.000Z',
    intakeDecision: 'task',
    attentionTier: 'today',
    taskAction: 'updated',
    actualNotification: 'silent',
    recommendedNotification: 'daily_digest',
    difference: 'notification timing differs',
    title: 'must never be emitted',
  }
}

test('audits a completed shadow window without emitting business content', () => {
  const report = auditShadowState({
    shadowMode: { enabled: true, startedAt: '2026-08-20T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z' },
    shadowDecisions: Array.from({ length: 20 }, (_, index) => decision(`om-${index}`)),
    shadowMatters: [{ key: 'matter' }],
    shadowTaskSnapshots: { task: {} },
    shadowFeedback: [],
  }, new Date('2026-08-28T00:00:00.000Z'))
  assert.equal(report.valid, true)
  assert.equal(report.readyForEvaluation, true)
  assert.equal(report.counts.decisions, 20)
  assert.equal(JSON.stringify(report).includes('must never be emitted'), false)
})

test('blocks duplicate decisions and keeps an unfinished window pending', () => {
  const report = auditShadowState({
    shadowMode: { enabled: true, startedAt: '2026-08-20T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z' },
    shadowDecisions: [decision('same'), decision('same')],
  }, new Date('2026-08-22T00:00:00.000Z'))
  assert.equal(report.readyForEvaluation, false)
  assert.deepEqual(report.blockers, [{ code: 'duplicate-message-id', count: 1 }])
  assert.ok(report.warnings.some((warning) => warning.code === 'shadow-window-in-progress'))
})
