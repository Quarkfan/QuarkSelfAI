import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import { createEd25519DeviceEnrollment, NodeEd25519DeviceProofVerifierV1, type LocalDeviceSecretStoreV1 } from '../src/client-runtime/device-identity.js'
import { runInactiveClientCycle } from '../src/client-runtime/inactive-client-cycle.js'
import { openSqliteInactiveClientState } from '../src/client-runtime/sqlite-client-state.js'
import type { SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { openSqliteInactiveDeviceSessionProvider } from '../src/control-plane/sqlite-device-session-provider.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

class MemorySecrets implements LocalDeviceSecretStoreV1 {
  readonly values = new Map<string, Uint8Array>()
  async put(reference: string, value: Uint8Array): Promise<void> { this.values.set(reference, Uint8Array.from(value)) }
  async get(reference: string): Promise<Uint8Array | undefined> { const value = this.values.get(reference); return value ? Uint8Array.from(value) : undefined }
}

const at = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T01:00:00.000Z'
const sha = `sha256:${'a'.repeat(64)}`
const context = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] as const }
const planVerifier = { verify: async ({ payloadDigest, signature }: { payloadDigest: string; signature: string }) => signature === `signed:${payloadDigest}` }

function signedPlan(): SignedExecutionPlanV1 {
  const unsigned = {
    schemaVersion: 1 as const, tenantId: context.tenantId, userId: context.userId, deviceId: 'device.owner', agentId: 'agent.demo', runId: 'run.one', actionId: 'action.one',
    blueprint: { id: 'agent.demo', version: '1.0.0', digest: sha }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [], idempotencyKey: 'run.one/action.one',
    deadline: later, budget: { tokens: 1, durationMs: 1000, costMinorUnits: 0 }, dataClasses: ['public'], allowedEffects: [],
    executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: ['tool.execute'], allowedExecutors: ['executor-a', 'dsh'], preferredExecutors: ['executor-a'] },
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false as const },
    plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'test-key' },
  }
  const digest = executionEnvelopePayloadDigest(unsigned)
  const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'test-key' } }
  return { schemaVersion: 1, planId: 'plan.one', issuedAt: at.toISOString(), expiresAt: later, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
}

test('authenticates, negotiates and durably acknowledges one lease without invoking an executor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-cycle-'))
  const serverDatabase = join(directory, 'server.sqlite3')
  const clientDatabase = join(directory, 'client.sqlite3')
  const identityMigration = new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname
  const sessionMigration = new URL('../migrations/control-plane-sqlite/004_device_sessions.sql', import.meta.url).pathname
  const clientMigration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
  const secrets = new MemorySecrets()
  try {
    const enrollment = await createEd25519DeviceEnrollment({ ...context, deviceId: 'device.owner', privateKeyRef: 'keychain:device.owner' }, secrets, at)
    const repository = await openSqliteTenantControlRepository(serverDatabase, identityMigration)
    const tenants = new TenantControlServiceV1(repository, { authorize: async () => true })
    await tenants.createTenant(context, { name: 'Test Alpha' }, at)
    await tenants.registerUser(context, { userId: context.userId, displayName: 'Owner' }, at)
    await tenants.registerDevice(context, { deviceId: enrollment.identity.deviceId, publicKey: enrollment.identity.publicKey }, at)
    await repository.close()
    let sequence = 0
    const server = await openSqliteInactiveDeviceSessionProvider(serverDatabase, [identityMigration, sessionMigration], { next: label => `${label}.${++sequence}` }, new NodeEd25519DeviceProofVerifierV1(), planVerifier)
    const plan = signedPlan()
    await server.enqueue({ tenantId: context.tenantId, userId: context.userId, taskId: 'task.one', deviceId: enrollment.identity.deviceId, plan, idempotencyKey: 'task.one', state: 'queued', createdAt: at.toISOString() }, at)

    let client = await openSqliteInactiveClientState(clientDatabase, clientMigration, planVerifier)
    client.enroll(enrollment.identity, enrollment.privateKeyRef)
    client.saveExecutorReport({ schemaVersion: 1, deviceId: enrollment.identity.deviceId, executorId: 'executor-a', availability: 'ready', version: '1.0.0', protocolVersions: ['envelope.v1'], capabilities: ['tool.execute'], constraints: [], discoveredAt: at.toISOString(), expiresAt: later })
    const first = await runInactiveClientCycle({ state: client, secrets, server, now: at })
    assert.deepEqual({ state: first.state, executorId: first.executorId, invoked: first.executorInvoked, effects: first.effectsActive }, { state: 'lease-accepted-inactive', executorId: 'executor-a', invoked: false, effects: 0 })
    await client.close()

    client = await openSqliteInactiveClientState(clientDatabase, clientMigration, planVerifier)
    const restored = await client.restoreRunJournal(new Date('2026-09-06T00:00:01.000Z'))
    assert.deepEqual(restored.exportCheckpoints().map(item => [item.taskId, item.state, item.executorId]), [['task.one', 'leased', 'executor-a']])
    const second = await runInactiveClientCycle({ state: client, secrets, server, now: new Date('2026-09-06T00:00:01.000Z') })
    assert.equal(second.state, 'online-empty')
    await client.close(); await server.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
