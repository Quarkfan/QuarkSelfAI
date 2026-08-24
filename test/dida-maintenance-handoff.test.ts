import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDidaMaintenanceHandoff, prepareDidaMaintenanceHandoff } from '../src/migration/dida-maintenance-handoff.js'

const authorization = {
  id: 'owner-policy:dida-cleanup:v1', grantedBy: 'owner' as const, grantedAt: '2026-08-20T00:00:00Z',
  scope: 'dida.completed-task-cleanup', revision: 1, source: 'owner-directive:periodic-cleanup',
  projectId: 'project-1', minimumRetentionDays: 30, maximumDeletesPerRun: 50,
}

test('prepares two content-addressed workflows from privacy-bounded legacy maintenance state', async () => {
  const handoff = prepareDidaMaintenanceHandoff({
    overdueNotified: { task1: '2026-08-20:5' },
    overdueHealthFailure: { at: '2026-08-23T00:00:00Z', count: 2, notified: false, error: 'must not migrate' },
    didaCompletedCleanupLastDay: '2026-08-22',
  }, {
    projectId: 'project-1', overdueRetryMs: 120_000, cleanupPollIntervalMs: 21_600_000,
    cleanupFailureNotifyThreshold: 5, cleanupAuthorization: authorization,
  }, '2026-08-24T00:00:00Z')
  assert.deepEqual(handoff.counts, { overdueFingerprints: 1, healthFailures: 1 })
  assert.equal(handoff.workflows.length, 2)
  assert.equal(handoff.workflows[0]?.state.retryMs, 120_000)
  assert.equal(handoff.workflows[1]?.state.pollIntervalMs, 21_600_000)
  assert.equal(handoff.workflows[1]?.state.failureThreshold, 5)
  assert.equal(JSON.stringify(handoff.workflows).includes('must not migrate'), false)
  const ids = new Set<string>()
  const target = { async createWorkflow(input: { id: string }) { const inserted = !ids.has(input.id); ids.add(input.id); return { inserted } } }
  assert.deepEqual(await applyDidaMaintenanceHandoff(target, handoff, handoff.digest), { inserted: 2, existing: 0 })
  assert.deepEqual(await applyDidaMaintenanceHandoff(target, handoff, handoff.digest), { inserted: 0, existing: 2 })
  await assert.rejects(applyDidaMaintenanceHandoff(target, handoff, 'wrong'), /digest changed/)
  assert.throws(() => prepareDidaMaintenanceHandoff({
    overdueHealthFailure: { at: '2026-08-23T00:00:00Z', count: -1 },
  }, { projectId: 'project-1', cleanupAuthorization: authorization }, '2026-08-24T00:00:00Z'), /non-negative integer/)
  assert.throws(() => prepareDidaMaintenanceHandoff({
    didaCompletedCleanupLastDay: 'not-a-day',
  }, { projectId: 'project-1', cleanupAuthorization: authorization }, '2026-08-24T00:00:00Z'), /YYYY-MM-DD/)
})
