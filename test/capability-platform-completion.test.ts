import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { auditCapabilityFormReadiness, auditCapabilityPlatformCompletion } from '../scripts/audit-capability-platform-completion.js'

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

test('separates canonical form evidence from activation and fails closed on lifecycle gaps', async () => {
  const ledger = JSON.parse(await readFile(new URL('../config/capability-platform-completion.json', import.meta.url), 'utf8'))
  const candidates = JSON.parse(await readFile(new URL('../config/capability-artifact-candidates.json', import.meta.url), 'utf8')).candidates
  const privateReceipt = JSON.parse(await readFile(new URL('../config/private-capability-receipt.json', import.meta.url), 'utf8'))
  const publicForms = JSON.parse(await readFile(new URL('../config/public-capability-form-artifacts.json', import.meta.url), 'utf8'))
  const report = auditCapabilityFormReadiness(ledger.capabilityForms, candidates, privateReceipt, publicForms)
  assert.equal(report.verified, false)
  assert.ok(report.blockers.includes('headless-browser:local-adapter-missing'))
  assert.ok(report.blockers.includes('private-integration:host-contract-compatibility-missing'))
  assert.equal(privateReceipt.validationState, 'verified-inactive-lifecycle')
  assert.equal(privateReceipt.inactiveLifecycleRehearsalVerified, true)
  assert.ok(candidates.every((candidate: { activationAllowed: boolean }) => candidate.activationAllowed === false))
})
