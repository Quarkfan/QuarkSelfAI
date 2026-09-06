import assert from 'node:assert/strict'
import test from 'node:test'
import { inactiveLifecycleSnapshot, planInactiveInstallation } from '../src/client-runtime/install-planner.js'
import type { ArtifactVerificationReportV1 } from '../src/client-runtime/contracts.js'

const digest = `sha256:${'a'.repeat(64)}`
const handlers = Object.fromEntries(['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => [action, { handlerInterface: `lifecycle.${action}`, supported: true, approval: action === 'stop' ? 'none' : action === 'install' || action === 'upgrade' || action === 'uninstall' || action === 'recover' ? 'install' : 'session' }]))
const lifecycleInterfaces = ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => ({ kind: 'runtime', id: `lifecycle.${action}`, version: '1.0.0', direction: 'provides', compatibility: ['1'] }))
const manifest = {
  schemaVersion: 1, id: 'tool/example', name: 'Example Tool', version: '1.0.0', kind: 'cli', description: 'Fixture',
  source: { kind: 'git', locator: 'https://example.invalid/tool.git', revision: 'r1', artifactDigest: digest, license: 'MIT', supplier: 'example', signature: { status: 'verified', keyId: 'fixture-key' }, sbom: { format: 'spdx', digest } },
  runtime: { placements: ['local'], isolation: 'process', supportedPlatforms: ['darwin-arm64'], executorRequirements: [], stateNamespace: 'tool.example', offlineCapable: true },
  requirements: [], lifecycle: handlers, interfaces: lifecycleInterfaces, dependencies: [], permissions: [], dataClasses: [],
  tests: [{ id: 'contract.default', kind: 'contract', required: true, effectMode: 'none' }], healthChecks: [],
  recovery: { strategy: 'reinstall', rollbackVersion: null, stateIncluded: false, restoreEffectsEnabled: false },
}
const checks = { license: 'pass', signature: 'pass', sbom: 'pass', malware: 'pass', maintenance: 'pass', dependencies: 'pass' } as const
const report: ArtifactVerificationReportV1 = { schemaVersion: 1, capabilityId: 'tool/example', version: '1.0.0', artifactDigest: digest, sourceRevision: 'r1', policyRevision: 'policy.1', checks, decision: 'verified', evaluatedAt: '2026-09-06T00:00:00.000Z' }

test('plans only an installed-inactive state after every supply-chain check passes', () => {
  const plan = planInactiveInstallation(manifest, report, 'device.demo', new Date('2026-09-06T00:00:00.000Z'))
  assert.deepEqual({ approval: plan.requiredApproval, target: plan.targetState, load: plan.loadAllowed, run: plan.runAllowed, writes: plan.externalWritesEnabled }, { approval: 'install', target: 'installed-inactive', load: false, run: false, writes: false })
  assert.deepEqual(inactiveLifecycleSnapshot(plan, new Date('2026-09-06T00:00:00.000Z')), { capabilityId: 'tool/example', version: '1.0.0', artifactDigest: digest, deviceId: 'device.demo', installation: 'installed', loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled', updatedAt: '2026-09-06T00:00:00.000Z' })
})

test('rejects warning evidence and identity drift before producing an install plan', () => {
  assert.throws(() => planInactiveInstallation(manifest, { ...report, checks: { ...checks, maintenance: 'warn' } }, 'device.demo'), /every supply-chain check/)
  assert.throws(() => planInactiveInstallation(manifest, { ...report, artifactDigest: `sha256:${'b'.repeat(64)}` }, 'device.demo'), /identity does not match/)
})
