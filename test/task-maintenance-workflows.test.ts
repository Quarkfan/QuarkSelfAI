import assert from 'node:assert/strict'
import test from 'node:test'
import { completedCleanupWorkflow, overdueWorkflow } from '../src/task-maintenance/workflows.js'
import { TASK_STORE_EFFECTS } from '../src/task-system/store-effects.js'
import { TASK_MAINTENANCE_EFFECTS } from '../src/task-system/maintenance-effects.js'
import { ASSISTANT_EFFECTS } from '../src/workflow/effects.js'

const config = {
  projectId: 'project-automation', failureNotifyThreshold: 2,
  cleanupAuthorization: {
    id: 'owner-policy:dida-cleanup:v1', grantedBy: 'owner' as const, grantedAt: '2026-08-20T00:00:00Z',
    scope: 'dida.completed-task-cleanup', revision: 1, source: 'owner-directive:periodic-cleanup',
    projectId: 'project-automation', minimumRetentionDays: 30, maximumDeletesPerRun: 50,
  },
}

test('overdue workflow emits stable notifications only when a task fingerprint changes', () => {
  const definition = overdueWorkflow(config)
  const initialized = definition.initialize({}, '2026-08-24T00:00:00.000Z')
  const scanning = definition.reduce(initialized.state, {
    id: 'timer:one', type: 'timer', occurredAt: '2026-08-24T00:00:01.000Z', payload: { scheduledAt: '2026-08-24T00:00:00.000Z' },
  })
  assert.equal(scanning.effects?.[0]?.kind, TASK_STORE_EFFECTS.listOverdue)
  const first = definition.reduce(scanning.state, {
    id: 'effect:scan:delivered', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:02.000Z',
    payload: { effectKind: TASK_STORE_EFFECTS.listOverdue, tasks: [{ taskId: 'task-1', title: '处理客户阻塞', dueDate: '2026-08-23', priority: 5 }] },
  })
  assert.equal(first.effects?.filter(effect => effect.kind === ASSISTANT_EFFECTS.notifyOwner).length, 1)
  const nextScan = definition.reduce(first.state, {
    id: 'timer:two', type: 'timer', occurredAt: '2026-08-24T00:30:02.000Z', payload: { scheduledAt: first.wakeAt },
  })
  const unchanged = definition.reduce(nextScan.state, {
    id: 'effect:scan-two:delivered', type: 'effect.delivered', occurredAt: '2026-08-24T00:30:03.000Z',
    payload: { effectKind: TASK_STORE_EFFECTS.listOverdue, tasks: [{ taskId: 'task-1', title: '处理客户阻塞', dueDate: '2026-08-23', priority: 5 }] },
  })
  assert.equal(unchanged.effects?.length, 0)
  const changedScan = definition.reduce(unchanged.state, {
    id: 'timer:three', type: 'timer', occurredAt: '2026-08-24T01:00:03.000Z', payload: { scheduledAt: unchanged.wakeAt },
  })
  const changed = definition.reduce(changedScan.state, {
    id: 'effect:scan-three:delivered', type: 'effect.delivered', occurredAt: '2026-08-24T01:00:04.000Z',
    payload: { effectKind: TASK_STORE_EFFECTS.listOverdue, tasks: [{ taskId: 'task-1', title: '处理客户阻塞', dueDate: '2026-08-23', priority: 3 }] },
  })
  assert.equal(changed.effects?.filter(effect => effect.kind === ASSISTANT_EFFECTS.notifyOwner).length, 1)
  assert.notEqual(changed.effects?.[0]?.id, first.effects?.[0]?.id)
})

test('overdue workflow persists failure debounce and emits one recovery notice', () => {
  const definition = overdueWorkflow(config)
  const initialized = definition.initialize({}, '2026-08-24T00:00:00.000Z')
  const scanOne = definition.reduce(initialized.state, { id: 'timer:1', type: 'timer', occurredAt: '2026-08-24T00:00:01.000Z', payload: {} })
  const failureOne = definition.reduce(scanOne.state, {
    id: 'effect:1:failed', type: 'effect.failed', occurredAt: '2026-08-24T00:10:00.000Z', payload: { effectKind: TASK_STORE_EFFECTS.listOverdue },
  })
  assert.equal(failureOne.effects?.length ?? 0, 0)
  const scanTwo = definition.reduce(failureOne.state, { id: 'timer:2', type: 'timer', occurredAt: '2026-08-24T00:20:00.000Z', payload: {} })
  const failureTwo = definition.reduce(scanTwo.state, {
    id: 'effect:2:failed', type: 'effect.failed', occurredAt: '2026-08-24T00:30:00.000Z', payload: { effectKind: TASK_STORE_EFFECTS.listOverdue },
  })
  assert.equal(failureTwo.effects?.filter(effect => effect.kind === ASSISTANT_EFFECTS.notifyOwner).length, 1)
  const scanThree = definition.reduce(failureTwo.state, { id: 'timer:3', type: 'timer', occurredAt: '2026-08-24T00:40:00.000Z', payload: {} })
  const recovered = definition.reduce(scanThree.state, {
    id: 'effect:3:delivered', type: 'effect.delivered', occurredAt: '2026-08-24T00:40:01.000Z', payload: { effectKind: TASK_STORE_EFFECTS.listOverdue, tasks: [] },
  })
  assert.equal(recovered.effects?.filter(effect => effect.kind === ASSISTANT_EFFECTS.notifyOwner).length, 1)
  assert.equal('failure' in recovered.state, false)
})

test('cleanup workflow runs once per local day and delegates deletion as an effect', () => {
  const definition = completedCleanupWorkflow(config)
  const initialized = definition.initialize({}, '2026-08-24T04:00:00.000Z')
  const cleaning = definition.reduce(initialized.state, {
    id: 'timer:cleanup', type: 'timer', occurredAt: '2026-08-24T04:00:01.000Z', payload: {},
  })
  assert.equal(cleaning.effects?.[0]?.kind, TASK_MAINTENANCE_EFFECTS.cleanupCompleted)
  assert.equal(cleaning.effects?.[0]?.payload.projectId, 'project-automation')
  assert.equal((cleaning.effects?.[0]?.payload.authorization as { id: string }).id, 'owner-policy:dida-cleanup:v1')
  const completed = definition.reduce(cleaning.state, {
    id: 'effect:cleanup:delivered', type: 'effect.delivered', occurredAt: '2026-08-24T04:00:02.000Z',
    payload: { effectKind: TASK_MAINTENANCE_EFFECTS.cleanupCompleted, deleted: [{ taskId: 'old-1', title: '旧任务', completedAt: '2026-06-01T00:00:00Z' }] },
  })
  assert.equal(completed.state.lastCompletedDay, '2026-08-24')
  assert.equal(completed.effects?.[0]?.kind, ASSISTANT_EFFECTS.notifyOwner)
  const sameDay = definition.reduce(completed.state, {
    id: 'timer:same-day', type: 'timer', occurredAt: '2026-08-24T05:00:00.000Z', payload: {},
  })
  assert.equal(sameDay.effects?.length ?? 0, 0)
})

test('cleanup workflow rejects missing or wider-than-approved authorization', () => {
  assert.throws(() => completedCleanupWorkflow({ projectId: 'project-automation' }), /authorization evidence is required/)
  assert.throws(() => completedCleanupWorkflow({ ...config, completedRetentionDays: 29 }), /authorization scope/)
  assert.throws(() => completedCleanupWorkflow({ ...config, cleanupMaxPerRun: 51 }), /authorization scope/)
})

test('maintenance definitions reject malformed effect results instead of advancing state', () => {
  const definition = overdueWorkflow(config)
  const scanning = definition.reduce(definition.initialize({}, '2026-08-24T00:00:00Z').state, {
    id: 'timer', type: 'timer', occurredAt: '2026-08-24T00:00:01Z', payload: {},
  })
  assert.throws(() => definition.reduce(scanning.state, {
    id: 'bad', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:02Z', payload: { effectKind: TASK_STORE_EFFECTS.listOverdue, tasks: [{ title: 'missing id' }] },
  }), /invalid overdue task/)
})
