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
    difference: 'aligned',
    title: 'must never be emitted',
    taskId: `task-${messageId}`,
    nextAction: 'complete the work',
    actionOwner: 'changdongxu',
    actionRequired: true,
  }
}

test('audits a completed shadow window without emitting business content', () => {
  const report = auditShadowState({
    shadowMode: { enabled: true, startedAt: '2026-08-20T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z' },
    shadowDecisions: Array.from({ length: 20 }, (_, index) => decision(`om-${index}`)),
    shadowMatters: Array.from({ length: 20 }, (_, index) => ({ key: `matter-om-${index}` })),
    shadowTaskSnapshots: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`task-om-${index}`, {
      projectId: 'todo', title: 'must not be emitted', status: 0, priority: 3, missingCount: 0,
    }])),
    shadowFeedback: [],
  }, new Date('2026-08-28T00:00:00.000Z'))
  assert.equal(report.valid, true)
  assert.equal(report.readyForEvaluation, true)
  assert.equal(report.counts.decisions, 20)
  assert.equal(report.counts.differences, 0)
  assert.equal(report.counts.taskMutations, 20)
  assert.equal(JSON.stringify(report).includes('must never be emitted'), false)
})

test('blocks duplicate decisions and keeps an unfinished window pending', () => {
  const report = auditShadowState({
    shadowMode: { enabled: true, startedAt: '2026-08-20T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z' },
    shadowDecisions: [decision('same'), decision('same')],
    shadowMatters: [{ key: 'matter-same' }],
  }, new Date('2026-08-22T00:00:00.000Z'))
  assert.equal(report.readyForEvaluation, false)
  assert.deepEqual(report.blockers, [{ code: 'duplicate-message-id', count: 1 }])
  assert.ok(report.warnings.some((warning) => warning.code === 'shadow-window-in-progress'))
})

test('blocks semantically inconsistent task and notification projections', () => {
  const report = auditShadowState({
    shadowMode: { enabled: true, startedAt: '2026-08-20T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z' },
    shadowDecisions: [{
      ...decision('bad'),
      taskAction: 'created',
      taskId: null,
      intakeDecision: 'information',
      actionRequired: false,
      actionOwner: 'unknown',
      nextAction: '',
      recommendedNotification: 'notify_now',
      difference: 'could_batch',
    }],
    shadowMatters: [{ key: 'matter-bad' }],
  }, new Date('2026-08-22T00:00:00.000Z'))
  assert.equal(report.valid, false)
  const codes = new Set(report.blockers.map((blocker) => blocker.code))
  assert.ok(codes.has('created-task-missing-id'))
  assert.ok(codes.has('created-task-invalid-intake'))
  assert.ok(codes.has('created-task-no-action'))
  assert.ok(codes.has('created-task-invalid-owner'))
  assert.ok(codes.has('created-task-missing-next-action'))
  assert.ok(codes.has('attention-notification-mismatch'))
  assert.ok(codes.has('notification-difference-mismatch'))
})
