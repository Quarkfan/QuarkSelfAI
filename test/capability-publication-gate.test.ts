import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompiledCapabilityArtifactCandidateV1 } from '../src/capability-platform/artifact-candidates.js'
import { prepareManifestPublicationCandidate } from '../src/capability-platform/publication-gate.js'

const sha = `sha256:${'a'.repeat(64)}`
const lifecycle = Object.fromEntries(['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => [action, { handlerInterface: `lifecycle.${action}`, supported: true, approval: action === 'stop' ? 'none' : 'install' }]))
const lifecycleInterfaces = ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => ({ kind: 'runtime', id: `lifecycle.${action}`, version: '1.0.0', direction: 'provides', compatibility: ['1'] }))
const candidate: CompiledCapabilityArtifactCandidateV1 = { schemaVersion: 1, id: 'tool/example', name: 'Example', kind: 'cli', targetPlane: 'local', moduleIds: ['example'], coveredModuleCount: 1, coveredModuleDigest: sha, blockers: ['artifact-digest-missing', 'license-decision-missing', 'lifecycle-contract-missing', 'permission-review-missing', 'sbom-missing', 'signature-missing'], manifestStatus: 'evidence-pending', activationAllowed: false, publicationAllowed: false, currentOwnerPreserved: true }
const manifest = {
  schemaVersion: 1, id: 'tool/example', name: 'Example', version: '1.0.0', kind: 'cli', description: 'Fixture',
  source: { kind: 'git', locator: 'https://example.invalid/example.git', revision: 'abc123', artifactDigest: sha, license: 'MIT', supplier: 'example', signature: { status: 'verified', keyId: 'release-key' }, sbom: { format: 'spdx', digest: sha } },
  runtime: { placements: ['local'], isolation: 'process', supportedPlatforms: ['darwin-arm64'], executorRequirements: [], stateNamespace: 'tool.example', offlineCapable: true },
  requirements: [], lifecycle, interfaces: lifecycleInterfaces, dependencies: [], permissions: [], dataClasses: [], tests: [{ id: 'contract.default', kind: 'contract', required: true, effectMode: 'none' }], healthChecks: [], recovery: { strategy: 'reinstall', rollbackVersion: null, stateIncluded: false, restoreEffectsEnabled: false },
}
const checks = { license: 'pass', signature: 'pass', sbom: 'pass', malware: 'pass', maintenance: 'pass', dependencies: 'pass' } as const
const evidence = { schemaVersion: 1 as const, capabilityId: 'tool/example', version: '1.0.0', artifactDigest: sha, sourceRevision: 'abc123', policyRevision: 'policy.1', checks, decision: 'verified' as const, evaluatedAt: '2026-09-06T00:00:00.000Z' }

test('prepares immutable review metadata but never permits publication or activation', () => {
  const result = prepareManifestPublicationCandidate(candidate, manifest, evidence)
  assert.deepEqual({ status: result.status, publish: result.publicationAllowed, activate: result.activationAllowed, owner: result.currentOwnerPreserved }, { status: 'validated-unpublished', publish: false, activate: false, owner: true })
  assert.match(result.manifestDigest, /^sha256:[a-f0-9]{64}$/)
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.manifest))
})

test('fails closed on evidence warnings, identity drift and private integration candidates', () => {
  assert.throws(() => prepareManifestPublicationCandidate(candidate, manifest, { ...evidence, checks: { ...checks, maintenance: 'warn' } }), /every artifact evidence check/)
  assert.throws(() => prepareManifestPublicationCandidate(candidate, { ...manifest, id: 'tool/other' }, evidence), /identity does not match/)
  assert.throws(() => prepareManifestPublicationCandidate(candidate, manifest, { ...evidence, artifactDigest: `sha256:${'b'.repeat(64)}` }), /evidence identity/)
  const privateCandidate = { ...candidate, id: 'private-work-integration', kind: 'integration-pack' as const, targetPlane: 'private-pack' as const, blockers: ['private-manifest-required' as const] }
  assert.throws(() => prepareManifestPublicationCandidate(privateCandidate, manifest, evidence), /inside the private pack/)
})
