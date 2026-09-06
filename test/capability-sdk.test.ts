import assert from 'node:assert/strict'
import test from 'node:test'
import { buildArtifactDigest, defineAgentBlueprint, defineCapabilityManifest, executorParityInputs } from '../src/capability-sdk/index.js'

const sha = `sha256:${'a'.repeat(64)}`
const lifecycle = Object.fromEntries(['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => [action, { handlerInterface: `lifecycle.${action}`, supported: true, approval: action === 'stop' ? 'none' : 'install' }]))
const lifecycleInterfaces = ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => ({ kind: 'runtime', id: `lifecycle.${action}`, version: '1.0.0', direction: 'provides', compatibility: ['1'] }))

function manifest() {
  return {
    schemaVersion: 1, id: 'tool/example', name: 'Example', version: '1.0.0', kind: 'cli', description: 'Fixture',
    source: { kind: 'git', locator: 'https://example.invalid/example.git', revision: 'r1', artifactDigest: sha, license: 'MIT', supplier: 'example', signature: { status: 'verified', keyId: 'fixture-key' }, sbom: { format: 'spdx', digest: sha } },
    runtime: { placements: ['local'], isolation: 'process', supportedPlatforms: ['darwin-arm64'], executorRequirements: [], stateNamespace: 'tool.example', offlineCapable: true },
    requirements: [], lifecycle, interfaces: lifecycleInterfaces, dependencies: [], permissions: [], dataClasses: [],
    tests: [{ id: 'contract.default', kind: 'contract', required: true, effectMode: 'none' }], healthChecks: [],
    recovery: { strategy: 'reinstall', rollbackVersion: null, stateIncluded: false, restoreEffectsEnabled: false },
  }
}

test('builds a stable artifact digest from sorted portable file digests', () => {
  const left = buildArtifactDigest({ revision: 'abc', files: [{ path: 'b.js', digest: sha }, { path: 'a.js', digest: sha }] })
  const right = buildArtifactDigest({ revision: 'abc', files: [{ path: 'a.js', digest: sha }, { path: 'b.js', digest: sha }] })
  assert.equal(left, right)
  assert.throws(() => buildArtifactDigest({ revision: 'abc', files: [{ path: '/private/file', digest: sha }] }), /portable/)
  assert.throws(() => buildArtifactDigest({ revision: 'abc', files: [{ path: 'a.js', digest: sha }, { path: 'a.js', digest: sha }] }), /unique/)
})

test('returns immutable validated Manifests and deterministic Blueprint revisions', () => {
  const capability = defineCapabilityManifest(manifest())
  assert.ok(Object.isFrozen(capability) && Object.isFrozen(capability.source))
  assert.throws(() => { (capability as { name: string }).name = 'changed' }, TypeError)
  const draft = {
    schemaVersion: 1 as const, id: 'agent/example', name: 'Example Agent', version: '1.0.0', revision: 'r1', releaseState: 'test' as const,
    role: 'worker', goals: ['Complete task'], capabilities: [], graph: { nodes: [], edges: [] }, triggers: [],
    executorPolicy: { preferred: ['claude-code'], fallback: ['codex', 'dsh'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
    deviceSelector: 'device:owner', workspaceHandles: [], permissions: [], modelPolicy: { allowed: ['provider-neutral'], preferred: null },
    budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 10 }, retry: { infrastructureAttempts: 2, deterministicAttempts: 1 },
    notifications: { channels: ['console'], on: ['completion'] }, retention: { localRawDays: 1, cloudSummaryDays: 7 },
  }
  assert.equal(defineAgentBlueprint(draft).digest, defineAgentBlueprint(structuredClone(draft)).digest)
})

test('gives Claude Code, Codex and DSH the same immutable normalized envelope', () => {
  const envelope = {
    schemaVersion: 1, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', agentId: 'agent.example', runId: 'run.001', actionId: 'action.001',
    blueprint: { id: 'agent/example', version: '1.0.0', digest: sha }, program: { role: 'worker', goals: ['Complete the fixture'], graph: { nodes: [], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [],
    idempotencyKey: 'run.001/action.001', deadline: '2027-01-01T00:00:00.000Z', budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 10 },
    dataClasses: [], allowedEffects: [], executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: [], allowedExecutors: ['claude-code', 'codex', 'dsh'], preferredExecutors: ['claude-code'] }, continuity: { sessionId: 'session.001', continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false },
    plan: { digest: sha, signature: 'signature-reference', keyId: 'test-key' },
  }
  const inputs = executorParityInputs(['claude-code', 'codex', 'dsh'], envelope as never)
  assert.equal(new Set(inputs.map(input => input.normalizedContextDigest)).size, 1)
  assert.ok(Object.isFrozen(inputs) && inputs.every(input => Object.isFrozen(input.envelope)))
})
