import assert from 'node:assert/strict'
import test from 'node:test'
import { runCapabilityPlatformCloudEdgePilot } from '../scripts/run-capability-platform-cloud-edge-pilot.js'

test('serves two isolated synthetic tenants through one ephemeral loopback edge and closes it', async t => {
  let report: Awaited<ReturnType<typeof runCapabilityPlatformCloudEdgePilot>>
  try { report = await runCapabilityPlatformCloudEdgePilot(new Date('2026-09-06T00:00:00.000Z')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit loopback listeners'); return }; throw error }
  assert.deepEqual(report.deviceCounts, [1, 1])
  assert.equal(report.tenantCount, 2)
  assert.equal(report.requestCount, 7)
  assert.equal(report.tenantInjectionRejected, true)
  assert.equal(report.databaseReopened, true)
  assert.deepEqual({ closed: report.listenerClosed, invoked: report.executorInvoked, effects: report.effectsActive, owner: report.currentOwnerPreserved }, { closed: true, invoked: false, effects: 0, owner: true })
})
