import assert from 'node:assert/strict'
import test from 'node:test'
import { auditCapabilityPlatformCompletion } from '../scripts/audit-capability-platform-completion.js'

test('reports the real platform completion blockers instead of treating inactive scaffolds as completion', async () => {
  const report = await auditCapabilityPlatformCompletion(process.cwd())
  assert.equal(report.ok, false)
  assert.equal(report.status, 'in-progress')
  assert.deepEqual(report.verified, ['all-modules-classified','single-consumer-provider-scheduler-writer','user-uncommitted-changes-preserved'])
  assert.ok(report.blockers.includes('real-multi-user-tenant-isolation:incomplete'))
  assert.ok(report.blockers.includes('installable-client-and-device-enrollment:incomplete'))
  assert.ok(report.blockers.includes('mainline-independent-from-private-work:incomplete'))
  assert.ok(report.blockers.includes('install-run-recover-upgrade-rollback-verified:incomplete'))
})
