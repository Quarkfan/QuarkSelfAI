import assert from 'node:assert/strict'
import test from 'node:test'
import { defineAgentBlueprint, defineCapabilityManifest } from '../src/capability-sdk/index.js'
import { InactiveDeviceSyncCoordinatorV1 } from '../src/client-runtime/inactive-sync.js'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'
import { InactiveTestAgentStudioV1 } from '../src/control-plane/test-agent-studio.js'
import { InactiveTestTenantControlPlaneV1 } from '../src/control-plane/test-tenant-store.js'
import { prepareInactiveShadowRun } from '../src/orchestration/inactive-shadow-run.js'

const now = new Date('2026-09-06T00:00:00.000Z')
const expiresAt = '2026-09-06T01:00:00.000Z'
const artifactDigest = `sha256:${'a'.repeat(64)}`
const context: TenantContextV1 = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] }
const lifecycle = Object.fromEntries(['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => [action, { handlerInterface: `lifecycle.${action}`, supported: true, approval: action === 'stop' ? 'none' : 'install' }]))
const lifecycleInterfaces = ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => ({ kind: 'runtime', id: `lifecycle.${action}`, version: '1.0.0', direction: 'provides', compatibility: ['1'] }))
const manifest = defineCapabilityManifest({
  schemaVersion: 1, id: 'tool/search', name: 'Search', version: '1.0.0', kind: 'cli', description: 'Fixture',
  source: { kind: 'git', locator: 'https://example.invalid/search.git', revision: 'r1', artifactDigest, license: 'MIT', supplier: 'example', signature: { status: 'verified', keyId: 'fixture-key' }, sbom: { format: 'spdx', digest: artifactDigest } },
  runtime: { placements: ['local'], isolation: 'process', supportedPlatforms: ['darwin-arm64'], executorRequirements: [], stateNamespace: 'tool.search', offlineCapable: true },
  requirements: [], lifecycle, interfaces: [{ kind: 'tool', id: 'search.query', version: '1.0.0', direction: 'provides', compatibility: ['1'] }, ...lifecycleInterfaces], dependencies: [], permissions: [], dataClasses: ['public'],
  tests: [{ id: 'contract.default', kind: 'contract', required: true, effectMode: 'none' }], healthChecks: [], recovery: { strategy: 'reinstall', rollbackVersion: null, stateIncluded: false, restoreEffectsEnabled: false },
})
const blueprint = defineAgentBlueprint({
  schemaVersion: 1, id: 'agent/search', name: 'Search Agent', version: '1.0.0', revision: 'r1', releaseState: 'test', role: 'researcher', goals: ['Find public facts'],
  capabilities: [{ id: manifest.id, versionRange: '^1.0.0', artifactDigest, required: true }], graph: { nodes: [{ id: 'search', capabilityId: manifest.id, interfaceId: 'search.query', configuration: {} }], edges: [] },
  triggers: [{ id: 'manual', kind: 'manual', specification: 'console', enabled: true }], executorPolicy: { preferred: ['claude-code'], fallback: ['codex', 'dsh'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
  deviceSelector: 'device:owner', workspaceHandles: ['workspace:project'], permissions: [], modelPolicy: { allowed: ['provider-neutral'], preferred: null }, budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 10 }, retry: { infrastructureAttempts: 2, deterministicAttempts: 1 }, notifications: { channels: ['console'], on: ['completion'] }, retention: { localRawDays: 1, cloudSummaryDays: 7 },
})

function fixture() {
  const studio = new InactiveTestAgentStudioV1()
  const controlPlane = new InactiveTestTenantControlPlaneV1()
  let token = 0
  const deviceSync = new InactiveDeviceSyncCoordinatorV1({ next: label => `${label}.${++token}` })
  controlPlane.createTestTenant({ tenantId: context.tenantId, name: 'Alpha' }, now)
  controlPlane.registerUser(context, { userId: context.userId, displayName: 'Owner' }, now)
  const device = controlPlane.registerDevice(context, { deviceId: 'device.owner', publicKey: 'public-key' }, now)
  deviceSync.registerDevice(device)
  const draft = studio.saveDraft(context, { draftId: 'draft.search', blueprint, expectedRevision: 0 }, now)
  const release = studio.publishTest(context, { draftId: draft.draftId, expectedRevision: draft.revision }, now)
  const dependencies = {
    studio, controlPlane, deviceSync,
    signer: { keyId: 'test-key', sign: async ({ payloadDigest }: { payloadDigest: string }) => `signed:${payloadDigest}` },
    deviceProofVerifier: { verify: async ({ challenge, signature }: { challenge: string; signature: string }) => signature === `signed:${challenge}` },
  }
  const input = {
    context, release, manifests: [manifest], taskId: 'task.001', executorIds: ['claude-code', 'codex', 'dsh'], now,
    compilation: { tenantId: context.tenantId, userId: context.userId, deviceId: device.deviceId, runId: 'run.001', actionId: 'action.001', planId: 'plan.001', idempotencyKey: 'run.001/action.001', issuedAt: now.toISOString(), expiresAt, context: [], workspaceGrants: [{ handle: 'workspace:project', access: 'read' as const, expiresAt, grantId: 'grant.workspace' }] },
    deviceProof: async (challenge: { challengeId: string; deviceId: string; nonce: string }) => ({ schemaVersion: 1 as const, challengeId: challenge.challengeId, deviceId: challenge.deviceId, keyId: 'device-key', algorithm: 'ed25519' as const, signature: `signed:${challenge.nonce}` }),
  }
  return { dependencies, input, controlPlane }
}

test('connects Studio to one device lease while every executor sees identical context', async () => {
  const { dependencies, input, controlPlane } = fixture()
  const receipt = await prepareInactiveShadowRun(dependencies, input)
  assert.deepEqual({ state: receipt.state, effects: receipt.externalWritesEnabled, invoked: receipt.executorInvoked, owner: receipt.currentOwnerPreserved }, { state: 'leased-unexecuted', effects: false, invoked: false, owner: true })
  assert.deepEqual(receipt.executorContexts.map(item => item.executorId), ['claude-code', 'codex', 'dsh'])
  assert.equal(new Set(receipt.executorContexts.map(item => item.normalizedContextDigest)).size, 1)
  assert.equal(controlPlane.getDispatch(context, input.taskId)?.state, 'leased')
  assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.executorContexts))
})

test('fails closed on stale Studio release and executor policy drift', async () => {
  const first = fixture()
  await assert.rejects(() => prepareInactiveShadowRun(first.dependencies, { ...first.input, release: { ...first.input.release, blueprintDigest: `sha256:${'b'.repeat(64)}` } }), /identity drifted/)
  const second = fixture()
  await assert.rejects(() => prepareInactiveShadowRun(second.dependencies, { ...second.input, executorIds: ['codex', 'claude-code', 'dsh'] }), /exactly match Blueprint policy order/)
})
