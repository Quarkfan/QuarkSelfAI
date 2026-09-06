import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createEd25519DeviceEnrollment, NodeEd25519DeviceProofVerifierV1, signDeviceSessionChallenge, type LocalDeviceSecretStoreV1 } from '../src/client-runtime/device-identity.js'
import { openSqliteInactiveDeviceSessionProvider } from '../src/control-plane/sqlite-device-session-provider.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

class MemorySecrets implements LocalDeviceSecretStoreV1 {
  readonly values = new Map<string, Uint8Array>()
  async put(reference: string, value: Uint8Array): Promise<void> { this.values.set(reference, Uint8Array.from(value)) }
  async get(reference: string): Promise<Uint8Array | undefined> { const value = this.values.get(reference); return value ? Uint8Array.from(value) : undefined }
}

const at = new Date('2026-09-06T00:00:00.000Z')

test('keeps a generated Ed25519 private key behind an opaque client reference and verifies a scoped proof', async () => {
  const secrets = new MemorySecrets()
  const enrollment = await createEd25519DeviceEnrollment({ tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'keychain:device.owner' }, secrets, at)
  assert.match(enrollment.identity.publicKey, /^ed25519-spki:/)
  assert.match(enrollment.publicKeyId, /^device-key\.[a-f0-9]{24}$/)
  assert.equal(JSON.stringify(enrollment.identity).includes('keychain:'), false)
  assert.ok(secrets.values.get(enrollment.privateKeyRef)?.byteLength)

  const challenge = { schemaVersion: 1 as const, challengeId: 'challenge.1', tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', nonce: 'nonce.random', issuedAt: at.toISOString(), expiresAt: '2026-09-06T00:01:00.000Z' }
  const proof = await signDeviceSessionChallenge({ identity: enrollment.identity, privateKeyRef: enrollment.privateKeyRef, challenge }, secrets)
  const verifier = new NodeEd25519DeviceProofVerifierV1()
  assert.equal(await verifier.verify({ publicKey: enrollment.identity.publicKey, algorithm: proof.algorithm, challenge: challenge.nonce, signature: proof.signature }), true)
  assert.equal(await verifier.verify({ publicKey: enrollment.identity.publicKey, algorithm: proof.algorithm, challenge: `${challenge.nonce}.tampered`, signature: proof.signature }), false)
})

test('rejects scope drift, secret reference reuse and a private key from another enrollment', async () => {
  const secrets = new MemorySecrets()
  const first = await createEd25519DeviceEnrollment({ tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.one', privateKeyRef: 'secret:device.one' }, secrets, at)
  const second = await createEd25519DeviceEnrollment({ tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.two', privateKeyRef: 'secret:device.two' }, secrets, at)
  await assert.rejects(() => createEd25519DeviceEnrollment({ tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.one', privateKeyRef: 'secret:device.one' }, secrets, at), /already exists/)
  const foreignChallenge = { schemaVersion: 1 as const, challengeId: 'challenge.2', tenantId: 'test.beta', userId: 'user.owner', deviceId: 'device.one', nonce: 'nonce.2', issuedAt: at.toISOString(), expiresAt: '2026-09-06T00:01:00.000Z' }
  await assert.rejects(() => signDeviceSessionChallenge({ identity: first.identity, privateKeyRef: first.privateKeyRef, challenge: foreignChallenge }, secrets), /outside/)
  const ownChallenge = { ...foreignChallenge, tenantId: 'test.alpha' }
  await assert.rejects(() => signDeviceSessionChallenge({ identity: first.identity, privateKeyRef: second.privateKeyRef, challenge: ownChallenge }, secrets), /does not match/)
})

test('opens one persistent tenant device session with a real client-generated proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-device-identity-'))
  const database = join(directory, 'control-plane.sqlite3')
  const identityMigration = new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname
  const sessionMigration = new URL('../migrations/control-plane-sqlite/004_device_sessions.sql', import.meta.url).pathname
  const context = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] as const }
  try {
    const secrets = new MemorySecrets()
    const enrollment = await createEd25519DeviceEnrollment({ ...context, deviceId: 'device.owner', privateKeyRef: 'keychain:device.owner' }, secrets, at)
    const repository = await openSqliteTenantControlRepository(database, identityMigration)
    const tenants = new TenantControlServiceV1(repository, { authorize: async () => true })
    await tenants.createTenant(context, { name: 'Test Alpha' }, at)
    await tenants.registerUser(context, { userId: context.userId, displayName: 'Owner' }, at)
    await tenants.registerDevice(context, { deviceId: enrollment.identity.deviceId, publicKey: enrollment.identity.publicKey }, at)
    await repository.close()

    let sequence = 0
    const server = await openSqliteInactiveDeviceSessionProvider(database, [identityMigration, sessionMigration], { next: label => `${label}.${++sequence}` }, new NodeEd25519DeviceProofVerifierV1(), { verify: async () => true })
    const challenge = await server.issueChallenge(context, enrollment.identity.deviceId, at)
    const proof = await signDeviceSessionChallenge({ identity: enrollment.identity, privateKeyRef: enrollment.privateKeyRef, challenge }, secrets)
    const session = await server.openSession(proof, at)
    assert.deepEqual({ tenantId: session.tenantId, userId: session.userId, deviceId: session.deviceId, state: session.state }, { tenantId: context.tenantId, userId: context.userId, deviceId: enrollment.identity.deviceId, state: 'active' })
    await server.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
