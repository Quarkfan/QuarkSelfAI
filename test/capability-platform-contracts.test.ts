import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { AgentBlueprintV1 } from '../src/capability-platform/blueprint.js'
import type { ExecutionEnvelopeV1 } from '../src/capability-platform/execution-envelope.js'
import type { CapabilityManifestV1 } from '../src/capability-platform/manifest.js'
import { InactiveCapabilityRegistryV1 } from '../src/capability-platform/inactive-registry.js'
import { canonicalJson, contentDigest, toExecutorAdapterInput, validateAgentBlueprint, validateCapabilityManifest, validateExecutionEnvelope } from '../src/capability-platform/validation.js'

const sha = `sha256:${'a'.repeat(64)}`
const later = '2027-01-01T00:00:00.000Z'

function manifest(overrides: Record<string, unknown> = {}): CapabilityManifestV1 {
  return {
    schemaVersion: 1,
    id: 'browser/headless',
    name: 'Headless Browser',
    version: '1.0.0',
    kind: 'browser-runtime',
    description: 'Portable browser automation runtime.',
    source: {
      kind: 'git', locator: 'https://example.invalid/browser.git', revision: '0123456', artifactDigest: sha,
      license: 'Apache-2.0', supplier: 'example', signature: { status: 'verified', keyId: 'release-key' },
      sbom: { format: 'spdx', digest: sha },
    },
    runtime: {
      placements: ['local'], isolation: 'browser-profile', supportedPlatforms: ['darwin-arm64'],
      executorRequirements: ['tool-call-v1'], stateNamespace: 'browser.headless', offlineCapable: true,
    },
    requirements: [
      { kind: 'system', id: 'browser-engine', versionRange: null, placement: 'local', required: true },
      { kind: 'executor', id: 'tool-call-v1', versionRange: '^1.0.0', placement: 'local', required: true },
    ],
    lifecycle: {
      install: { handlerInterface: 'lifecycle.install', supported: true, approval: 'install' },
      load: { handlerInterface: 'lifecycle.load', supported: true, approval: 'session' },
      start: { handlerInterface: 'lifecycle.start', supported: true, approval: 'session' },
      stop: { handlerInterface: 'lifecycle.stop', supported: true, approval: 'none' },
      upgrade: { handlerInterface: 'lifecycle.upgrade', supported: true, approval: 'install' },
      uninstall: { handlerInterface: 'lifecycle.uninstall', supported: true, approval: 'install' },
      recover: { handlerInterface: 'lifecycle.recover', supported: true, approval: 'install' },
    },
    interfaces: [
      { kind: 'tool', id: 'browser.navigate', version: '1.0.0', direction: 'provides', compatibility: ['1'] },
      ...['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => ({
        kind: 'runtime' as const, id: `lifecycle.${action}`, version: '1.0.0', direction: 'provides' as const, compatibility: ['1'],
      })),
    ],
    dependencies: [],
    permissions: [{
      id: 'browser.session', kind: 'browser', operations: ['execute'], scope: 'browser-profile:ephemeral',
      placement: 'local', approval: 'session', required: true, dataClasses: ['user-content'],
    }],
    dataClasses: ['user-content'],
    tests: [{ id: 'contract.default', kind: 'contract', required: true, effectMode: 'none' }],
    healthChecks: [{ id: 'health.ready', interfaceId: 'browser.navigate', placement: 'local', timeoutMs: 5000, required: true }],
    recovery: { strategy: 'reinstall', rollbackVersion: null, stateIncluded: false, restoreEffectsEnabled: false },
    ...overrides,
  }
}

function blueprint(overrides: Record<string, unknown> = {}): AgentBlueprintV1 {
  return {
    schemaVersion: 1,
    id: 'agent/research', name: 'Research Agent', version: '1.0.0', revision: 'r1', digest: sha,
    releaseState: 'test', role: 'researcher', goals: ['Produce a sourced brief'],
    capabilities: [{ id: 'browser/headless', versionRange: '^1.0.0', artifactDigest: sha, required: true }],
    graph: { nodes: [{ id: 'browse', capabilityId: 'browser/headless', interfaceId: 'browser.navigate', configuration: {} }], edges: [] },
    triggers: [{ id: 'manual', kind: 'manual', specification: 'console', enabled: true }],
    executorPolicy: { preferred: ['claude-code'], fallback: ['codex', 'dsh'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
    deviceSelector: 'device:owner', workspaceHandles: ['workspace:project'], permissions: [],
    modelPolicy: { allowed: ['provider-neutral'], preferred: null },
    budget: { tokens: 10000, durationMs: 300000, costMinorUnits: 100 },
    retry: { infrastructureAttempts: 2, deterministicAttempts: 1 },
    notifications: { channels: ['console'], on: ['approval', 'completion', 'failure'] },
    retention: { localRawDays: 7, cloudSummaryDays: 30 },
    ...overrides,
  }
}

function envelope(overrides: Record<string, unknown> = {}): ExecutionEnvelopeV1 {
  return {
    schemaVersion: 1,
    tenantId: 'tenant.demo', userId: 'user.demo', deviceId: 'device.demo', agentId: 'agent.research',
    runId: 'run.001', actionId: 'action.001',
    blueprint: { id: 'agent/research', version: '1.0.0', digest: sha },
    capabilities: [{ id: 'browser/headless', version: '1.0.0', artifactDigest: sha }],
    context: [{ id: 'task', kind: 'instruction', dataClass: 'user-content', location: 'cloud', opaqueReference: 'context:task-001' }],
    workspaceGrants: [{ handle: 'workspace:project', access: 'read', expiresAt: later, grantId: 'grant.workspace' }],
    approvalGrants: [], idempotencyKey: 'tenant.demo/run.001/action.001', deadline: later,
    budget: { tokens: 10000, durationMs: 300000, costMinorUnits: 100 }, dataClasses: ['user-content'], allowedEffects: [],
    continuity: { sessionId: 'session.001', continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false },
    plan: { digest: sha, signature: 'signature-reference', keyId: 'plan-key' },
    ...overrides,
  }
}

test('validates a portable capability and registers it only as catalogued inactive', () => {
  const candidate = manifest()
  assert.equal(validateCapabilityManifest(candidate), candidate)
  const registry = new InactiveCapabilityRegistryV1()
  const first = registry.register(candidate, new Date('2026-09-06T00:00:00.000Z'))
  assert.deepEqual({ state: first.state, consumers: first.consumerCount, provider: first.providerLease, schedulers: first.schedulerCount, writes: first.externalWritesEnabled },
    { state: 'catalogued-inactive', consumers: 0, provider: null, schedulers: 0, writes: false })
  assert.equal(registry.register(structuredClone(candidate)), first)
  assert.throws(() => registry.register(manifest({ source: { ...candidate.source, artifactDigest: `sha256:${'b'.repeat(64)}` } })), /another digest/)
})

test('manifest validation fails closed for host paths, secret-shaped scopes, effects, offline placement and unsafe restore', () => {
  const base = manifest()
  assert.throws(() => validateCapabilityManifest(manifest({ source: { ...base.source, locator: '/Users/example/tool' } })), /portable/)
  assert.throws(() => validateCapabilityManifest(manifest({ permissions: [{ ...base.permissions[0], scope: 'token=plaintext' }] })), /secret-shaped/)
  assert.throws(() => validateCapabilityManifest(manifest({ permissions: [{ ...base.permissions[0], kind: 'external-effect', approval: 'session', effect: { kind: 'send', externalWrite: true, writeVerificationRequired: false } }] })), /action approval/)
  assert.throws(() => validateCapabilityManifest(manifest({ runtime: { ...base.runtime, placements: ['cloud'], offlineCapable: true } })), /offline capability/)
  assert.throws(() => validateCapabilityManifest(manifest({ recovery: { ...base.recovery, restoreEffectsEnabled: true } })), /effects disabled/)
  assert.throws(() => validateCapabilityManifest(manifest({ lifecycle: { ...base.lifecycle, recover: undefined } })), /manifest.lifecycle.recover/)
  assert.throws(() => validateCapabilityManifest(manifest({ requirements: [{ ...base.requirements[0], placement: 'cloud' }] })), /placement is not supported/)
  assert.throws(() => validateCapabilityManifest(manifest({ kind: 'mystery' })), /manifest.kind is invalid/)
  assert.throws(() => validateCapabilityManifest(manifest({ executable: 'rm' })), /unknown fields/)
  assert.throws(() => validateCapabilityManifest(manifest({ source: { ...base.source, kind: 'download' } })), /source.kind is invalid/)
  assert.throws(() => validateCapabilityManifest(manifest({ interfaces: base.interfaces.filter(item => item.id !== 'lifecycle.start') })), /not declared as provided/)
  assert.throws(() => validateCapabilityManifest(manifest({ interfaces: base.interfaces.map(item => item.id === 'browser.navigate' ? { ...item, version: '1' } : item) })), /semantic version/)
  assert.throws(() => validateCapabilityManifest(manifest({ healthChecks: [{ ...base.healthChecks[0], interfaceId: 'browser.missing' }] })), /not declared as provided/)
})

test('blueprint graph and executor continuity are deterministic and fail closed', () => {
  const base = blueprint()
  assert.equal(validateAgentBlueprint(base), base)
  assert.throws(() => validateAgentBlueprint(blueprint({ graph: { ...base.graph, edges: [{ from: 'browse', to: 'missing', output: 'result', input: 'query' }] } })), /unknown node/)
  assert.throws(() => validateAgentBlueprint(blueprint({ executorPolicy: { ...base.executorPolicy, allowMidActionSwitch: true } })), /continuity/)
  assert.throws(() => validateAgentBlueprint(blueprint({ retry: { ...base.retry, deterministicAttempts: 2 } })), /cannot be retried/)
})

test('all executors receive one normalized envelope and approvals remain exactly scoped', () => {
  const base = envelope()
  assert.equal(validateExecutionEnvelope(base), base)
  const inputs = ['claude-code', 'codex', 'dsh'].map(id => toExecutorAdapterInput(id, structuredClone(base)))
  assert.equal(new Set(inputs.map(item => item.normalizedContextDigest)).size, 1)
  assert.ok(inputs.every(item => item.envelope.actionId === base.actionId))
  const approval = {
    grantId: 'grant.effect', tenantId: base.tenantId, userId: base.userId, deviceId: base.deviceId,
    agentId: base.agentId, releaseDigest: sha, actionId: base.actionId, effectKind: 'message.send', scope: 'conversation:owner',
    grantedAt: '2026-09-06T00:00:00.000Z', expiresAt: later, singleUse: true,
  }
  assert.doesNotThrow(() => validateExecutionEnvelope(envelope({ allowedEffects: ['message.send'], approvalGrants: [approval] })))
  assert.throws(() => validateExecutionEnvelope(envelope({ allowedEffects: ['message.send'], approvalGrants: [{ ...approval, userId: 'user.other' }] })), /scope does not match/)
  assert.throws(() => validateExecutionEnvelope(envelope({ context: [{ ...base.context[0], opaqueReference: '/private/workspace' }] })), /opaque references/)
  assert.throws(() => validateExecutionEnvelope(envelope({ continuity: { ...base.continuity, midActionSwitchAllowed: true } })), /mid-action/)
})

test('canonical digests are stable and public schemas remain closed', async () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }))
  assert.equal(contentDigest({ b: 2, a: 1 }), contentDigest({ a: 1, b: 2 }))
  for (const file of ['capability-manifest.schema.json', 'agent-blueprint.schema.json', 'execution-envelope.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(`../config/schemas/${file}`, import.meta.url), 'utf8')) as Record<string, unknown>
    assert.equal(schema.additionalProperties, false)
    assert.ok(Array.isArray(schema.required) && schema.required.length > 0)
  }
})
