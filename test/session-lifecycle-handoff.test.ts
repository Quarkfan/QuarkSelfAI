import assert from 'node:assert/strict'
import test from 'node:test'
import { applySessionLifecycleHandoff, prepareSessionLifecycleHandoff } from '../src/migration/session-lifecycle-handoff.js'

test('prepares privacy-bounded idempotent session lifecycle workflows', async () => {
  const active = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const archived = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const handoff = prepareSessionLifecycleHandoff({
    mentionClarifications: [{ researchSessionId: active }],
    mentionResearchSessions: [
      { sessionId: active, taskId: 'task-active', createdAt: '2026-08-20T00:00:00Z', archiveFailureCount: 2,
        archiveLastAttemptAt: '2026-08-23T00:00:00Z', archiveLastError: 'must not migrate' },
      { sessionId: archived, taskId: 'task-archived', createdAt: '2026-08-01T00:00:00Z', archivedAt: '2026-08-10T00:00:00Z' },
    ],
  }, { deleteAfterDays: 7 }, '2026-08-24T00:00:00Z')
  assert.deepEqual(handoff.counts, { tracked: 2, archived: 1, deleted: 0, waiting: 1, failures: 2 })
  assert.equal(handoff.workflows[0]?.state.eligible, false)
  assert.equal(handoff.workflows[1]?.state.phase, 'archived')
  assert.equal(JSON.stringify(handoff.workflows).includes('must not migrate'), false)
  const ids = new Set<string>()
  const target = { async createWorkflow(input: { id: string }) { const inserted = !ids.has(input.id); ids.add(input.id); return { inserted } } }
  assert.deepEqual(await applySessionLifecycleHandoff(target, handoff, handoff.digest), { inserted: 2, existing: 0 })
  assert.deepEqual(await applySessionLifecycleHandoff(target, handoff, handoff.digest), { inserted: 0, existing: 2 })
  await assert.rejects(applySessionLifecycleHandoff(target, handoff, 'wrong'), /digest changed/)
  assert.throws(() => prepareSessionLifecycleHandoff({ mentionResearchSessions: [{ sessionId: 'unsafe', taskId: 'task' }] }, {},
    '2026-08-24T00:00:00Z'), /exact UUID/)
})
