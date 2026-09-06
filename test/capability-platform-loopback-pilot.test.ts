import assert from 'node:assert/strict'
import test from 'node:test'
import { runCapabilityPlatformPilot } from '../scripts/run-capability-platform-pilot.js'

test('uses one ephemeral IPv4 loopback and checkpoints a signed no-effect lease', async t => {
  let report: Awaited<ReturnType<typeof runCapabilityPlatformPilot>>
  try {
    report = await runCapabilityPlatformPilot(new Date('2026-09-06T00:00:00.000Z'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('sandbox does not permit loopback listeners')
      return
    }
    throw error
  }
  assert.deepEqual(report.transport, { kind: 'loopback-http', addressClass: 'ipv4-loopback', ephemeralPort: true, stopped: true })
  assert.deepEqual({ state: report.receipt.state, invoked: report.executorInvoked, effects: report.effectsActive, owner: report.currentOwnerPreserved }, { state: 'leased-unexecuted', invoked: false, effects: 0, owner: true })
  assert.equal(report.receipt.tenantClass, 'synthetic-test')
  assert.match(report.receipt.checkpointDigest, /^sha256:[a-f0-9]{64}$/)
})
