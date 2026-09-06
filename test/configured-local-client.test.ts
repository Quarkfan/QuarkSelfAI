import assert from 'node:assert/strict'
import { chmod, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { DeviceEnrollmentClientPortV1, DeviceSessionServerPortV1 } from '../src/control-plane/contracts.js'
import { compileInactiveClientBootstrap, InactiveConfiguredLocalClientV1 } from '../src/client-runtime/configured-local-client.js'

const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const now = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T00:10:00.000Z'
const masterKey = new Uint8Array(32).fill(17)
const verifier = { async verify() { return true } }

function document(stateRoot: string) { return { schemaVersion: 1, controlPlaneEndpoint: 'https://control.example.com/', stateRoot, tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner' } as const }

test('assembles one configured client without connecting and resumes enrollment across reopen', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-client-')); const root = await realpath(temporary)
  let begins = 0
  const enrollment: DeviceEnrollmentClientPortV1 = {
    async begin(input) { begins += 1; assert.equal(input.deviceId, 'device.owner'); return { schemaVersion: 1, requestId: `enrollment.${'a'.repeat(32)}`, userCode: 'AAAA-BBBB-CCCC-DDDD', pollToken: 'A'.repeat(43), verificationPath: '/devices/activate', expiresAt: later, pollAfterSeconds: 5 } },
    async poll(input) { return { schemaVersion: 1, requestId: input.requestId, deviceId: 'device.owner', state: 'pending', expiresAt: later } }
  }
  const sessions = { async issueChallenge() { throw new Error('unexpected network') }, async openSession() { throw new Error('unexpected network') }, async poll() { throw new Error('unexpected network') }, async acknowledge() { throw new Error('unexpected network') }, async submitResult() { throw new Error('unexpected network') } } as unknown as DeviceSessionServerPortV1
  const dependencies = { masterKeys: { async load() { return Uint8Array.from(masterKey) } }, enrollment, sessions }
  try {
    const plan = await compileInactiveClientBootstrap(document(root), migration)
    assert.deepEqual({ autoConnect: plan.autoConnect, autoPoll: plan.autoPollEnrollment, effects: plan.externalWritesEnabled }, { autoConnect: false, autoPoll: false, effects: false })
    let client = await InactiveConfiguredLocalClientV1.initialize(plan, verifier, dependencies, now)
    assert.equal(begins, 0); assert.equal(client.snapshot(now).connection, 'disconnected')
    assert.equal((await client.beginEnrollment(now)).state, 'pending'); assert.equal(begins, 1)
    await client.close()
    client = await InactiveConfiguredLocalClientV1.initialize(plan, verifier, dependencies, now)
    assert.equal((await client.beginEnrollment(now)).requestId, `enrollment.${'a'.repeat(32)}`); assert.equal(begins, 1)
    await client.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects mutable, aliased, unsafe and open-ended bootstrap input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-client-')); const root = await realpath(temporary); const alias = `${root}-link`
  try {
    await assert.rejects(compileInactiveClientBootstrap({ ...document(root), extra: true }, migration), /document is invalid/)
    await assert.rejects(compileInactiveClientBootstrap({ ...document(root), controlPlaneEndpoint: 'http://example.com/' }, migration), /HTTPS or explicit ephemeral/)
    await chmod(root, 0o755); await assert.rejects(compileInactiveClientBootstrap(document(root), migration), /private canonical/); await chmod(root, 0o700)
    await symlink(root, alias); await assert.rejects(compileInactiveClientBootstrap(document(alias), migration), /private canonical/)
  } finally { await rm(alias, { force: true }); await rm(root, { recursive: true, force: true }) }
})

test('rejects an activated or drifted bootstrap plan before reading a master key', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-client-')); const root = await realpath(temporary); let reads = 0
  try {
    const plan = await compileInactiveClientBootstrap(document(root), migration)
    await assert.rejects(InactiveConfiguredLocalClientV1.initialize({ ...plan, autoConnect: true as false }, verifier, { masterKeys: { async load() { reads += 1; return Uint8Array.from(masterKey) } } }, now), /not inactive/)
    await assert.rejects(InactiveConfiguredLocalClientV1.initialize({ ...plan, client: { ...plan.client, paths: { ...plan.client.paths, artifactRoot: join(root, 'elsewhere') } } }, verifier, { masterKeys: { async load() { reads += 1; return Uint8Array.from(masterKey) } } }, now), /paths drifted/)
    assert.equal(reads, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
