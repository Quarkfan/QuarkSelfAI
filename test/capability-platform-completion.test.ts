import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { auditCapabilityFormReadiness, auditCapabilityPlatformCompletion, hasFeishuSubscriptionOwnership, hasNoDidaAcceptance, hasOptionalDida, hasRequiredFeishu } from '../scripts/audit-capability-platform-completion.js'

test('reports the real platform completion blockers instead of treating inactive scaffolds as completion', async () => {
  const report = await auditCapabilityPlatformCompletion(process.cwd())
  assert.equal(report.ok, false)
  assert.equal(report.status, 'in-progress')
  assert.deepEqual(report.verified, ['all-modules-classified','console-agent-compose-test-version','five-capability-forms','single-consumer-provider-scheduler-writer','user-uncommitted-changes-preserved'])
  assert.ok(report.blockers.includes('real-multi-user-tenant-isolation:incomplete'))
  assert.ok(report.blockers.includes('installable-client-and-device-enrollment:incomplete'))
  assert.ok(report.blockers.includes('mainline-independent-from-private-work:incomplete'))
  assert.ok(report.blockers.includes('install-run-recover-upgrade-rollback-verified:incomplete'))
  assert.ok(report.blockers.includes('feishu-first-new-user:incomplete'))
  assert.ok(report.blockers.includes('dida-optional-new-user:incomplete'))
})

test('separates canonical form evidence from activation and fails closed on lifecycle gaps', async () => {
  const ledger = JSON.parse(await readFile(new URL('../config/capability-platform-completion.json', import.meta.url), 'utf8'))
  const candidates = JSON.parse(await readFile(new URL('../config/capability-artifact-candidates.json', import.meta.url), 'utf8')).candidates
  const privateReceipt = JSON.parse(await readFile(new URL('../config/private-capability-receipt.json', import.meta.url), 'utf8'))
  const publicForms = JSON.parse(await readFile(new URL('../config/public-capability-form-artifacts.json', import.meta.url), 'utf8'))
  const report = auditCapabilityFormReadiness(ledger.capabilityForms, candidates, privateReceipt, publicForms)
  assert.equal(report.verified, true)
  assert.deepEqual(report.blockers, [])
  assert.equal(report.blockers.some((blocker: string) => blocker.startsWith('private-integration:')), false)
  assert.equal(privateReceipt.validationState, 'verified-inactive-lifecycle')
  assert.equal(privateReceipt.inactiveLifecycleRehearsalVerified, true)
  assert.equal(privateReceipt.adapterContractVerified, true)
  assert.equal(privateReceipt.runtimeHostImportCount, 0)
  assert.equal(privateReceipt.archivedHostImportCount, 12)
  assert.equal(privateReceipt.hostContractCompatibilityVerified, true)
  assert.equal(privateReceipt.equivalentReplayVerifiedGroupCount, 0)
  assert.ok(candidates.every((candidate: { activationAllowed: boolean }) => candidate.activationAllowed === false))
})

test('Feishu is required and Dida is not yet optional in the current composition', async () => {
  const composition = JSON.parse(await readFile(new URL('../config/product-composition.json', import.meta.url), 'utf8'))
  const catalog = JSON.parse(await readFile(new URL('../config/module-catalog.json', import.meta.url), 'utf8'))
  assert.equal(hasRequiredFeishu(composition), true)
  assert.equal(hasOptionalDida(composition, catalog), false)
  const candidate = {
    ...composition,
    capabilities: composition.capabilities.map((capability: { id: string; required: boolean }) =>
      capability.id === 'task-projection-and-maintenance' ? { ...capability, required: false } : capability),
    requiredConfiguration: composition.requiredConfiguration.filter((name: string) => !name.startsWith('DIDA_')),
  }
  assert.equal(hasOptionalDida(candidate, catalog), false, 'removing Dida configuration does not create an internal projection')
  const internal = {
    ...candidate,
    capabilities: [...candidate.capabilities, { id: 'internal-task-projection', required: true, modules: ['internal-task-projection'] }],
  }
  const withInternalProvider = { ...catalog, modules: [...catalog.modules, { id: 'internal-task-projection', providesEffects: ['assistant.task-projection.upsert-intake.v1'] }] }
  assert.equal(hasOptionalDida(internal, withInternalProvider), true)
  assert.equal(hasRequiredFeishu({ ...candidate, capabilities: candidate.capabilities.filter((item: { id: string }) => item.id !== 'message-intake') }), false)
})

test('does not mistake a projection module or one-device session for subscription and cross-device ownership', () => {
  const ready = {
    subscriptionMode: 'dedicated-client', subscriptionIdentityVerified: true, consumerOwnerVerified: true,
    crossDeviceMatterFenceVerified: true, matterRecoveryVerified: true,
    currentAuthorizationVerified: true, liveColdStartVerified: true,
  }
  assert.equal(hasFeishuSubscriptionOwnership({ ...ready, subscriptionMode: 'undecided' }), false)
  assert.equal(hasFeishuSubscriptionOwnership({ ...ready, consumerOwnerVerified: false }), false)
  assert.equal(hasNoDidaAcceptance(ready), true)
  for (const key of ['crossDeviceMatterFenceVerified', 'matterRecoveryVerified', 'currentAuthorizationVerified', 'liveColdStartVerified'] as const) {
    assert.equal(hasNoDidaAcceptance({ ...ready, [key]: false }), false, `${key} must remain an independent gate`)
  }
  assert.equal(hasNoDidaAcceptance({ ...ready, subscriptionMode: 'shared-server' }), true)
})
