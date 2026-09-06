import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { LocalMasterKeyProviderV1 } from '../src/client-runtime/contracts.js'
import { InactiveEncryptedLocalClientV1 } from '../src/client-runtime/encrypted-local-client.js'

const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const verifier = { verify: async () => true }; const at = new Date('2026-09-06T00:00:00.000Z')

test('bootstraps and reopens one encrypted inactive client without probing or connecting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-encrypted-client-')); const config = { paths: { databasePath: join(directory, 'client.sqlite3'), migrationPath: migration, artifactRoot: join(directory, 'artifacts'), instanceLeasePath: join(directory, 'runtime', 'owner.lock') }, secretRoot: join(directory, 'secrets'), enrollment: { tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner' } }
  let returned: Uint8Array | undefined
  const provider: LocalMasterKeyProviderV1 = { async load() { returned = new Uint8Array(32).fill(6); return returned } }
  try {
    let client = await InactiveEncryptedLocalClientV1.initialize(config, verifier, provider, at)
    assert.equal(client.enrollment?.identity.deviceId, 'device.owner'); assert.equal(client.snapshot(at).connection, 'disconnected'); assert.ok(returned?.every(value => value === 0)); await client.close()
    client = await InactiveEncryptedLocalClientV1.initialize(config, verifier, provider, at)
    assert.equal(client.enrollment, null); assert.deepEqual({ consumers: client.snapshot(at).ownedConsumers, providers: client.snapshot(at).ownedProviders, effects: client.snapshot(at).externalWritesEnabled }, { consumers: 0, providers: 0, effects: false }); await client.close()
    await assert.rejects(() => InactiveEncryptedLocalClientV1.initialize(config, verifier, { async load() { return new Uint8Array(32).fill(7) } }, at), /authentication failed/)
    await assert.rejects(() => InactiveEncryptedLocalClientV1.initialize({ ...config, enrollment: { ...config.enrollment, deviceId: 'device.other' } }, verifier, provider, at), /does not match/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rejects and clears a malformed provider key before opening client state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-encrypted-client-')); const key = new Uint8Array(31).fill(1)
  try {
    await assert.rejects(() => InactiveEncryptedLocalClientV1.initialize({ paths: { databasePath: join(directory, 'client.sqlite3'), migrationPath: migration, artifactRoot: join(directory, 'artifacts'), instanceLeasePath: join(directory, 'runtime', 'owner.lock') }, secretRoot: join(directory, 'secrets'), enrollment: { tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner' } }, verifier, { async load() { return key } }, at), /invalid key/)
    assert.ok(key.every(value => value === 0))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('resumes one cloud enrollment request and removes its encrypted poll credential after approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-cloud-enroll-')); const databasePath = join(directory, 'client.sqlite3'); const secretRoot = join(directory, 'secrets'); const config = { paths: { databasePath, migrationPath: migration, artifactRoot: join(directory, 'artifacts'), instanceLeasePath: join(directory, 'runtime', 'owner.lock') }, secretRoot, enrollment: { tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner' } }; const master = { async load() { return new Uint8Array(32).fill(8) } }; const pollToken = Buffer.alloc(32, 3).toString('base64url'); let begins = 0; let approved = false
  const server = {
    async begin() { begins += 1; return { schemaVersion: 1 as const, requestId: 'enrollment.11111111111111111111111111111111', userCode: '1111-2222-3333-4444', pollToken, verificationPath: '/devices/activate' as const, expiresAt: '2026-09-06T00:10:00.000Z', pollAfterSeconds: 5 as const } },
    async approve() { throw new Error('client must not approve') },
    async poll() { return { schemaVersion: 1 as const, requestId: 'enrollment.11111111111111111111111111111111', deviceId: 'device.owner', state: approved ? 'approved' as const : 'pending' as const, expiresAt: '2026-09-06T00:10:00.000Z' } },
  }
  try {
    let client = await InactiveEncryptedLocalClientV1.initialize(config, verifier, master, at)
    assert.equal((await client.beginDeviceEnrollment(server, at)).state, 'pending'); assert.equal(begins, 1); assert.equal((await readdir(secretRoot)).length, 2); await client.close()
    assert.equal((await readFile(databasePath)).includes(Buffer.from(pollToken)), false)
    client = await InactiveEncryptedLocalClientV1.initialize(config, verifier, master, at)
    assert.equal((await client.beginDeviceEnrollment(server, at)).state, 'pending'); assert.equal(begins, 1)
    approved = true; const result = await client.pollDeviceEnrollment(server, new Date('2026-09-06T00:01:00.000Z')); assert.deepEqual({ state: result.state, cleanup: result.credentialCleanupPending }, { state: 'approved', cleanup: false }); assert.equal((await readdir(secretRoot)).length, 1); await client.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('cleans an expired poll credential before creating one replacement request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-expired-enroll-')); const config = { paths: { databasePath: join(directory, 'client.sqlite3'), migrationPath: migration, artifactRoot: join(directory, 'artifacts'), instanceLeasePath: join(directory, 'runtime', 'owner.lock') }, secretRoot: join(directory, 'secrets'), enrollment: { tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner' } }; let count = 0
  const server = { async begin() { count += 1; const digit = String(count); return { schemaVersion: 1 as const, requestId: `enrollment.${digit.repeat(32)}`, userCode: `${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}`, pollToken: Buffer.alloc(32, count).toString('base64url'), verificationPath: '/devices/activate' as const, expiresAt: '2026-09-06T00:10:00.000Z', pollAfterSeconds: 5 as const } }, async approve() { throw new Error('client must not approve') }, async poll(input: { requestId: string }) { return { schemaVersion: 1 as const, requestId: input.requestId, deviceId: 'device.owner', state: 'expired' as const, expiresAt: '2026-09-06T00:10:00.000Z' } } }
  try {
    const client = await InactiveEncryptedLocalClientV1.initialize(config, verifier, { async load() { return new Uint8Array(32).fill(9) } }, at)
    await client.beginDeviceEnrollment(server, at); assert.equal((await client.pollDeviceEnrollment(server, at)).state, 'expired'); assert.equal((await client.beginDeviceEnrollment(server, at)).state, 'pending'); assert.equal(count, 2); assert.equal((await readdir(config.secretRoot)).length, 2); await client.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
