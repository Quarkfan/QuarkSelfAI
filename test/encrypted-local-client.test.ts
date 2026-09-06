import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
