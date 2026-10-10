import assert from 'node:assert/strict'
import test from 'node:test'
import { defineAgentBlueprint } from '../src/capability-sdk/index.js'
import { RegisteredNoEffectAgentOrchestratorV1 } from '../src/control-plane/agent-orchestration.js'
import { RoleTenantAuthorizationV1 } from '../src/control-plane/tenant-service.js'

const at = new Date('2026-10-10T00:00:00.000Z')
const context = { tenantId: 'personal', userId: 'owner', roles: ['owner'] as const }
const blueprint = defineAgentBlueprint({
  schemaVersion: 1, id: 'agent/basic', name: 'Basic Agent', version: '1.0.0', revision: 'r1', releaseState: 'test',
  role: 'assistant', goals: ['Return a bounded result'], capabilities: [], graph: { nodes: [], edges: [] },
  triggers: [{ id: 'manual', kind: 'manual', specification: 'console', enabled: true }],
  executorPolicy: { preferred: ['claude-code'], fallback: ['codex', 'dsh'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
  deviceSelector: 'device:owner', workspaceHandles: [], permissions: [], modelPolicy: { allowed: ['provider-neutral'], preferred: null },
  budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 0 }, retry: { infrastructureAttempts: 2, deterministicAttempts: 1 },
  notifications: { channels: ['console'], on: ['completion'] }, retention: { localRawDays: 1, cloudSummaryDays: 7 },
})

function fixture(deviceUser = 'owner') {
  const queued: unknown[] = []
  const draft = { tenantId: 'personal', userId: 'owner', draftId: 'draft.basic', blueprint, revision: 1, state: 'test-released' as const, createdAt: at.toISOString(), updatedAt: at.toISOString() }
  const release = { tenantId: 'personal', userId: 'owner', draftId: draft.draftId, blueprintId: blueprint.id, version: blueprint.version, blueprintDigest: blueprint.digest, draftRevision: 1, state: 'test' as const, createdAt: at.toISOString() }
  const studio = { async saveDraft() { return draft }, async publishTest() { return release }, async getDraft() { return draft }, async getTestRelease() { return release }, async listDrafts() { return [draft] }, async close() {} }
  const capabilities = { async registerInactive() { throw new Error('unused') }, async get() { return undefined }, async listVisible() { return [] }, async close() {} }
  const devices = { async registerDevice() { throw new Error('unused') }, async listDevices() { return [{ tenantId: 'personal', userId: deviceUser, deviceId: 'device.owner', publicKey: 'public', state: 'registered' as const, createdAt: at.toISOString() }] } }
  const queue = { async enqueue(value: never) { queued.push(value); return value } }
  let sequence = 0
  const service = new RegisteredNoEffectAgentOrchestratorV1(studio, capabilities, devices, queue, { keyId: 'control.primary', async sign({ payloadDigest }) { return `signed:${payloadDigest}` } }, { next(label) { sequence += 1; return `${label}.${sequence}` } }, new RoleTenantAuthorizationV1())
  return { service, queued }
}

test('queues one signed registered-tenant Agent test release without effects', async () => {
  const { service, queued } = fixture()
  const receipt = await service.dispatchTest(context, { draftId: 'draft.basic', expectedRevision: 1, deviceId: 'device.owner' }, at)
  assert.equal(receipt.state, 'queued')
  assert.equal(receipt.externalWritesEnabled, false)
  assert.equal(queued.length, 1)
  const dispatch = queued[0] as { tenantId: string; userId: string; plan: { envelope: { allowedEffects: unknown[]; approvalGrants: unknown[]; executorRequirement: { allowedExecutors: string[] } } } }
  assert.deepEqual({ tenant: dispatch.tenantId, user: dispatch.userId, effects: dispatch.plan.envelope.allowedEffects, approvals: dispatch.plan.envelope.approvalGrants, executors: dispatch.plan.envelope.executorRequirement.allowedExecutors }, { tenant: 'personal', user: 'owner', effects: [], approvals: [], executors: ['claude-code', 'codex', 'dsh'] })
})

test('rejects a device owned by another user before queue mutation', async () => {
  const { service, queued } = fixture('member')
  await assert.rejects(() => service.dispatchTest(context, { draftId: 'draft.basic', expectedRevision: 1, deviceId: 'device.owner' }, at), /outside the user scope/)
  assert.equal(queued.length, 0)
})
