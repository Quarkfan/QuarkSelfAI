import assert from 'node:assert/strict'
import test from 'node:test'
import { ASSISTANT_EFFECTS } from '../src/workflow/effects.js'
import { SESSION_EFFECTS } from '../src/session-lifecycle/types.js'
import { TASK_EFFECTS } from '../src/task-system/effects.js'
import { sessionLifecycleWorkflow } from '../src/session-lifecycle/workflow.js'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const event = (id: string, type: string, occurredAt: string, payload: Record<string, unknown> = {}) => ({ id, type, occurredAt, payload })

test('session lifecycle archives only after task completion and deletes only through a rechecking effect', () => {
  const definition = sessionLifecycleWorkflow({ pollIntervalMs: 60_000, deleteAfterDays: 7 })
  const initial = definition.initialize({ sessionId, taskId: 'task-1' }, '2026-08-01T00:00:00Z')
  const inspecting = definition.reduce(initial.state, event('timer:1', 'timer', '2026-08-01T00:00:01Z'))
  assert.equal(inspecting.effects?.[0]?.kind, SESSION_EFFECTS.inspect)
  const checking = definition.reduce(inspecting.state, event('inspect:1', 'effect.delivered', '2026-08-01T00:00:02Z', {
    effectKind: SESSION_EFFECTS.inspect, exists: true, archived: false, running: false,
  }))
  assert.equal(checking.effects?.[0]?.kind, TASK_EFFECTS.isCompleted)
  const archiving = definition.reduce(checking.state, event('task:1', 'effect.delivered', '2026-08-01T00:00:03Z', {
    effectKind: TASK_EFFECTS.isCompleted, completed: true,
  }))
  assert.equal(archiving.effects?.[0]?.kind, SESSION_EFFECTS.archiveIfNeeded)
  const archived = definition.reduce(archiving.state, event('archive:1', 'effect.delivered', '2026-08-01T00:00:04Z', {
    effectKind: SESSION_EFFECTS.archiveIfNeeded, archivedAt: '2026-08-01T00:00:04Z', alreadyArchived: false,
  }))
  assert.equal(archived.state.phase, 'archived')
  assert.equal(archived.effects?.[0]?.kind, ASSISTANT_EFFECTS.notifyOwner)
  assert.equal(archived.wakeAt, '2026-08-08T00:00:04.000Z')
  const deleting = definition.reduce(archived.state, event('timer:delete', 'timer', archived.wakeAt as string))
  assert.equal(deleting.effects?.[0]?.kind, SESSION_EFFECTS.deleteIfArchived)
  const manualUnarchive = definition.reduce(deleting.state, event('delete:deferred', 'effect.delivered', '2026-08-08T00:00:05Z', {
    effectKind: SESSION_EFFECTS.deleteIfArchived, outcome: 'not-archived',
  }))
  assert.equal(manualUnarchive.status, 'waiting')
  assert.equal(manualUnarchive.state.phase, 'archived')
  const deletingAgain = definition.reduce(manualUnarchive.state, event('timer:delete-2', 'timer', '2026-08-08T00:01:05Z'))
  const completed = definition.reduce(deletingAgain.state, event('delete:missing', 'effect.delivered', '2026-08-08T00:01:06Z', {
    effectKind: SESSION_EFFECTS.deleteIfArchived, outcome: 'missing',
  }))
  assert.equal(completed.status, 'completed')
  assert.equal(completed.state.deletedAt, '2026-08-08T00:01:06Z')
})

test('session lifecycle waits while clarification owns the session and stores bounded failure metadata', () => {
  const definition = sessionLifecycleWorkflow({ pollIntervalMs: 60_000, retryBaseMs: 60_000, retryMaxMs: 120_000 })
  const initial = definition.initialize({ sessionId, taskId: 'task-1', eligible: false }, '2026-08-01T00:00:00Z')
  const idle = definition.reduce(initial.state, event('timer:blocked', 'timer', '2026-08-01T00:00:01Z'))
  assert.equal(idle.effects?.length ?? 0, 0)
  const eligible = definition.reduce(idle.state, event('eligible', 'session.eligible', '2026-08-01T00:00:02Z'))
  const inspecting = definition.reduce(eligible.state, event('timer:inspect', 'timer', '2026-08-01T00:00:03Z'))
  const failed = definition.reduce(inspecting.state, event('inspect:failed', 'effect.failed', '2026-08-01T00:00:04Z', {
    effectKind: SESSION_EFFECTS.inspect, error: 'private filesystem error must not persist',
  }))
  assert.equal(failed.state.phase, 'waiting')
  assert.equal(JSON.stringify(failed.state).includes('private filesystem error'), false)
  assert.equal(failed.effects?.[0]?.kind, ASSISTANT_EFFECTS.notifyOwner)
})
