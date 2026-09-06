import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import { createEd25519DeviceEnrollment, NodeEd25519DeviceProofVerifierV1, type LocalDeviceSecretStoreV1 } from '../src/client-runtime/device-identity.js'
import { NodeInactiveHttpDeviceTransportV1 } from '../src/client-runtime/http-device-transport.js'
import { runInactiveClientCycle } from '../src/client-runtime/inactive-client-cycle.js'
import { openSqliteInactiveClientState } from '../src/client-runtime/sqlite-client-state.js'
import { InactiveCloudControlPlaneApplicationV1 } from '../src/control-plane/cloud-application.js'
import type { SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { InactiveCloudHttpHandlerV1 } from '../src/control-plane/http-handler.js'
import { openEphemeralLoopbackCloudEdge } from '../src/control-plane/node-http-adapter.js'
import { openSqliteInactiveDeviceSessionProvider } from '../src/control-plane/sqlite-device-session-provider.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

class MemorySecrets implements LocalDeviceSecretStoreV1 {
  readonly values = new Map<string, Uint8Array>()
  async put(reference: string, value: Uint8Array): Promise<void> { this.values.set(reference, Uint8Array.from(value)) }
  async get(reference: string): Promise<Uint8Array | undefined> { const value = this.values.get(reference); return value ? Uint8Array.from(value) : undefined }
}

const sha = `sha256:${'a'.repeat(64)}`
const context = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] as const }
const planVerifier = { verify: async ({ payloadDigest, signature }: { payloadDigest: string; signature: string }) => signature === `signed:${payloadDigest}` }

function plan(at: Date, later: string): SignedExecutionPlanV1 {
  const unsigned = { schemaVersion: 1 as const, tenantId: context.tenantId, userId: context.userId, deviceId: 'device.owner', agentId: 'agent.demo', runId: 'run.http', actionId: 'action.http',
    blueprint: { id: 'agent.demo', version: '1.0.0', digest: sha }, program: { role: 'worker', goals: ['Complete the fixture'], graph: { nodes: [], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [], idempotencyKey: 'run.http/action.http', deadline: later,
    budget: { tokens: 1, durationMs: 1000, costMinorUnits: 0 }, dataClasses: ['public'], allowedEffects: [], executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: [], allowedExecutors: ['executor-a'], preferredExecutors: ['executor-a'] },
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: false, midActionSwitchAllowed: false as const }, plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'test-key' } }
  const digest = executionEnvelopePayloadDigest(unsigned); const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'test-key' } }
  return { schemaVersion: 1, planId: 'plan.http', issuedAt: at.toISOString(), expiresAt: later, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
}

test('runs the inactive client cycle across a real bounded loopback HTTP edge', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-http-device-'))
  const identityMigration = new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname
  const sessionMigration = new URL('../migrations/control-plane-sqlite/004_device_sessions.sql', import.meta.url).pathname
  const clientMigration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
  const serverDatabase = join(directory, 'server.sqlite3'); const clientDatabase = join(directory, 'client.sqlite3')
  const now = new Date(); const later = new Date(now.getTime() + 60_000).toISOString(); const secrets = new MemorySecrets()
  let edge: Awaited<ReturnType<typeof openEphemeralLoopbackCloudEdge>> | undefined
  try {
    const enrollment = await createEd25519DeviceEnrollment({ ...context, deviceId: 'device.owner', privateKeyRef: 'keychain:device.owner' }, secrets, now)
    const repository = await openSqliteTenantControlRepository(serverDatabase, identityMigration)
    const tenants = new TenantControlServiceV1(repository, { authorize: async () => true })
    await tenants.createTenant(context, { name: 'Test Alpha' }, now); await tenants.registerUser(context, { userId: context.userId, displayName: 'Owner' }, now)
    await tenants.registerDevice(context, { deviceId: enrollment.identity.deviceId, publicKey: enrollment.identity.publicKey }, now); await repository.close()
    let sequence = 0
    const sessions = await openSqliteInactiveDeviceSessionProvider(serverDatabase, [identityMigration, sessionMigration], { next: label => `${label}.${++sequence}` }, new NodeEd25519DeviceProofVerifierV1(), planVerifier)
    const signed = plan(now, later)
    await sessions.enqueue({ tenantId: context.tenantId, userId: context.userId, taskId: 'task.http', deviceId: 'device.owner', plan: signed, idempotencyKey: 'task.http', state: 'queued', createdAt: now.toISOString() }, now)
    const capabilities = { async listVisible() { return [] }, async registerInactive() { throw new Error('unused') }, async get() { return undefined }, async close() {} }
    const studio = { async listDrafts() { return [] }, async saveDraft() { throw new Error('unused') }, async publishTest() { throw new Error('unused') }, async getDraft() { return undefined }, async close() {} }
    const app = new InactiveCloudControlPlaneApplicationV1({ resolveSession: async () => undefined }, capabilities, studio, tenants, sessions)
    edge = await openEphemeralLoopbackCloudEdge(new InactiveCloudHttpHandlerV1(app))
    const transport = new NodeInactiveHttpDeviceTransportV1(`http://${edge.host}:${edge.port}`)
    const client = await openSqliteInactiveClientState(clientDatabase, clientMigration, planVerifier)
    client.enroll(enrollment.identity, enrollment.privateKeyRef)
    client.saveExecutorReport({ schemaVersion: 1, deviceId: 'device.owner', executorId: 'executor-a', availability: 'ready', version: '1.0.0', protocolVersions: ['envelope.v1'], capabilities: [], constraints: [], discoveredAt: now.toISOString(), expiresAt: later })
    const receipt = await runInactiveClientCycle({ state: client, secrets, server: transport, now: new Date() })
    assert.deepEqual({ state: receipt.state, invoked: receipt.executorInvoked, effects: receipt.effectsActive, requests: edge.requestCount() }, { state: 'lease-accepted-inactive', invoked: false, effects: 0, requests: 4 })
    await client.close(); await edge.close(); edge = undefined; await sessions.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit loopback listeners'); return }
    throw error
  } finally { if (edge) await edge.close(); await rm(directory, { recursive: true, force: true }) }
})

test('rejects plaintext non-loopback device endpoints', () => {
  assert.throws(() => new NodeInactiveHttpDeviceTransportV1('http://example.com/'), /HTTPS or explicit ephemeral/)
  assert.doesNotThrow(() => new NodeInactiveHttpDeviceTransportV1('https://control.example.com/'))
})
