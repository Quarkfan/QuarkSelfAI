import assert from 'node:assert/strict'
import test from 'node:test'
import { blueprintPayloadDigest } from '../src/capability-platform/validation.js'
import { verifySignedExecutionPlan } from '../src/client-runtime/validation.js'
import { compileTestExecutionPlan } from '../src/orchestration/blueprint-compiler.js'

const artifactDigest = `sha256:${'a'.repeat(64)}`
const at = '2026-09-06T00:00:00.000Z'
const expires = '2026-09-06T01:00:00.000Z'
const lifecycle = Object.fromEntries(['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => [action, { handlerInterface: `lifecycle.${action}`, supported: true, approval: action === 'stop' ? 'none' : action === 'install' || action === 'upgrade' || action === 'uninstall' || action === 'recover' ? 'install' : 'session' }]))
const lifecycleInterfaces = ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => ({ kind: 'runtime', id: `lifecycle.${action}`, version: '1.0.0', direction: 'provides', compatibility: ['1'] }))
const manifest = {
  schemaVersion: 1, id: 'tool/search', name: 'Search', version: '1.2.0', kind: 'cli', description: 'Fixture',
  source: { kind: 'git', locator: 'https://example.invalid/search.git', revision: 'r1', artifactDigest, license: 'MIT', supplier: 'example', signature: { status: 'verified', keyId: 'fixture-key' }, sbom: { format: 'spdx', digest: artifactDigest } },
  runtime: { placements: ['local'], isolation: 'process', supportedPlatforms: ['darwin-arm64'], executorRequirements: [], stateNamespace: 'tool.search', offlineCapable: true },
  requirements: [], lifecycle, interfaces: [{ kind: 'tool', id: 'search.query', version: '1.0.0', direction: 'provides', compatibility: ['1'] }, ...lifecycleInterfaces], dependencies: [], permissions: [], dataClasses: ['public'],
  tests: [{ id: 'contract.default', kind: 'contract', required: true, effectMode: 'none' }], healthChecks: [], recovery: { strategy: 'reinstall', rollbackVersion: null, stateIncluded: false, restoreEffectsEnabled: false },
}

function blueprint(overrides: Record<string, unknown> = {}) {
  const value = {
    schemaVersion: 1 as const, id: 'agent/search', name: 'Search Agent', version: '1.0.0', revision: 'r1', digest: `sha256:${'0'.repeat(64)}`, releaseState: 'test', role: 'researcher', goals: ['Find facts'],
    capabilities: [{ id: 'tool/search', versionRange: '^1.0.0', artifactDigest, required: true }],
    graph: { nodes: [{ id: 'search', capabilityId: 'tool/search', interfaceId: 'search.query', configuration: {} }], edges: [] },
    triggers: [{ id: 'manual', kind: 'manual', specification: 'console', enabled: true }],
    executorPolicy: { preferred: ['executor-a'], fallback: ['safe-fallback'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
    deviceSelector: 'device:owner', workspaceHandles: ['workspace:project'], permissions: [], modelPolicy: { allowed: ['model-a'], preferred: 'model-a' },
    budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 10 }, retry: { infrastructureAttempts: 2, deterministicAttempts: 1 },
    notifications: { channels: ['console'], on: ['completion', 'failure'] }, retention: { localRawDays: 1, cloudSummaryDays: 7 }, ...overrides,
  }
  return { ...value, digest: blueprintPayloadDigest(value as never) }
}

const compileInput = {
  tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', runId: 'run.001', actionId: 'action.001', planId: 'plan.001',
  idempotencyKey: 'run.001/action.001', issuedAt: at, expiresAt: expires, context: [],
  workspaceGrants: [{ handle: 'workspace:project', access: 'read' as const, expiresAt: expires, grantId: 'grant.workspace' }],
}
const signer = { keyId: 'test-key', sign: async ({ payloadDigest }: { payloadDigest: string }) => `signed:${payloadDigest}` }

test('compiles an immutable blueprint and pinned artifacts into one verifiable no-effect plan', async () => {
  const plan = await compileTestExecutionPlan(blueprint(), [manifest], compileInput, signer)
  assert.deepEqual(plan.envelope.capabilities, [{ id: 'tool/search', version: '1.2.0', artifactDigest }])
  assert.deepEqual(plan.envelope.allowedEffects, [])
  assert.equal(plan.envelope.continuity.midActionSwitchAllowed, false)
  await assert.doesNotReject(() => verifySignedExecutionPlan(plan, { verify: async input => input.signature === `signed:${input.payloadDigest}` }, new Date('2026-09-06T00:30:00.000Z')))
})

test('fails closed on artifact ambiguity, workspace gaps and graph cycles', async () => {
  await assert.rejects(() => compileTestExecutionPlan(blueprint(), [], compileInput, signer), /exactly one verified artifact/)
  await assert.rejects(() => compileTestExecutionPlan(blueprint(), [manifest], { ...compileInput, workspaceGrants: [] }, signer), /workspace handle/)
  const cyclic = blueprint({ graph: { nodes: [{ id: 'one', capabilityId: 'tool/search', interfaceId: 'search.query', configuration: {} }, { id: 'two', capabilityId: 'tool/search', interfaceId: 'search.query', configuration: {} }], edges: [{ from: 'one', to: 'two', output: 'result', input: 'query' }, { from: 'two', to: 'one', output: 'result', input: 'query' }] } })
  await assert.rejects(() => compileTestExecutionPlan(cyclic, [manifest], compileInput, signer), /contains a cycle/)
})

test('inactive compiler rejects production tenants and external effects', async () => {
  await assert.rejects(() => compileTestExecutionPlan(blueprint(), [manifest], { ...compileInput, tenantId: 'tenant.production' }, signer), /test tenants only/)
  const permission = { id: 'effect.send', kind: 'external-effect', operations: ['write'], scope: 'message:owner', placement: 'cloud', approval: 'action', required: true, dataClasses: [], effect: { kind: 'message.send', externalWrite: true, writeVerificationRequired: true } }
  await assert.rejects(() => compileTestExecutionPlan(blueprint({ permissions: [permission] }), [manifest], compileInput, signer), /rejects external effects/)
})
