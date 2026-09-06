import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { InactiveInstallationPlanV1 } from '../src/client-runtime/contracts.js'
import { InactiveArtifactStoreV1 } from '../src/client-runtime/inactive-artifact-store.js'
import { openSqliteInactiveClientState } from '../src/client-runtime/sqlite-client-state.js'

const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const verifier = { verify: async () => true }
const at = new Date('2026-09-06T00:00:00.000Z')
const identity = { schemaVersion: 1 as const, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', publicKey: 'public.opaque', keyAlgorithm: 'ed25519' as const, createdAt: at.toISOString(), attestation: { kind: 'self' as const, reference: 'attestation.opaque' } }
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`
function plan(version: string, value: string): InactiveInstallationPlanV1 { return { schemaVersion: 1, planId: `plan-${version}`, deviceId: identity.deviceId, capabilityId: 'tool/example', version, artifactDigest: digest(value), isolation: 'process', lifecycleHandler: 'lifecycle.install', requiredApproval: 'install', targetState: 'installed-inactive', loadAllowed: false, runAllowed: false, externalWritesEnabled: false, createdAt: at.toISOString() } }

test('lands verified blobs, upgrades and rolls back only the selected inactive version across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-artifacts-')); const database = join(directory, 'client.sqlite3'); const root = join(directory, 'store')
  const first = join(directory, 'first.bin'); const second = join(directory, 'second.bin'); await writeFile(first, 'artifact-one'); await writeFile(second, 'artifact-two')
  try {
    let state = await openSqliteInactiveClientState(database, migration, verifier); state.enroll(identity, 'keychain:device.owner')
    let store = await InactiveArtifactStoreV1.open(root, state)
    const receipt = await store.install(plan('1.0.0', 'artifact-one'), first, at)
    assert.deepEqual({ target: receipt.targetState, loading: receipt.loading, authorization: receipt.authorization, execution: receipt.execution, effects: receipt.effects }, { target: 'installed-inactive', loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled' })
    assert.equal(state.inactiveCapabilitySelection('tool/example')?.currentVersion, '1.0.0')
    assert.equal((await store.install(plan('1.0.0', 'artifact-one'), first, new Date('2026-09-06T00:00:30.000Z'))).installedAt, at.toISOString())
    const upgraded = await store.upgrade(plan('2.0.0', 'artifact-two'), second, new Date('2026-09-06T00:01:00.000Z'))
    assert.deepEqual({ current: upgraded.currentVersion, previous: upgraded.previousVersion }, { current: '2.0.0', previous: '1.0.0' })
    await state.close()

    state = await openSqliteInactiveClientState(database, migration, verifier); store = await InactiveArtifactStoreV1.open(root, state)
    assert.equal((await store.verifyInstalled('tool/example', '2.0.0')).artifactDigest, digest('artifact-two'))
    const firstBlob = join(root, 'blobs', digest('artifact-one').slice(7)); await writeFile(firstBlob, 'tampered')
    await assert.rejects(() => store.rollback('tool/example', new Date('2026-09-06T00:01:30.000Z')), /integrity/)
    assert.equal(state.inactiveCapabilitySelection('tool/example')?.currentVersion, '2.0.0')
    await writeFile(firstBlob, 'artifact-one')
    const rolledBack = await store.rollback('tool/example', new Date('2026-09-06T00:02:00.000Z'))
    assert.deepEqual({ current: rolledBack.currentVersion, previous: rolledBack.previousVersion }, { current: '1.0.0', previous: '2.0.0' })
    const projection = state.cloudProjection(at); assert.deepEqual({ installed: projection.installedCapabilityCount, active: projection.activeCapabilityCount, consumers: projection.ownedConsumers, providers: projection.ownedProviders, schedulers: projection.ownedSchedulers, effects: projection.externalWritesEnabled }, { installed: 2, active: 0, consumers: 0, providers: 0, schedulers: 0, effects: false })
    assert.equal(JSON.stringify(projection).includes(root), false); assert.equal(JSON.stringify(projection).includes(digest('artifact-one')), false)
    await state.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('fails closed on digest drift, path-like identity, symlink source and tampered installed blob', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-artifacts-')); const database = join(directory, 'client.sqlite3'); const root = join(directory, 'store'); const source = join(directory, 'artifact.bin'); await writeFile(source, 'trusted')
  try {
    const state = await openSqliteInactiveClientState(database, migration, verifier); state.enroll(identity, 'secret:device.owner'); const store = await InactiveArtifactStoreV1.open(root, state)
    await assert.rejects(() => store.install(plan('1.0.0', 'different'), source, at), /digest does not match/)
    await assert.rejects(() => store.install({ ...plan('1.0.0', 'trusted'), capabilityId: '../escape' }, source, at), /identity is invalid/)
    const link = join(directory, 'link.bin'); await symlink(source, link); await assert.rejects(() => store.install(plan('1.0.0', 'trusted'), link, at), /regular file/)
    await store.install(plan('1.0.0', 'trusted'), source, at)
    const receipt = await store.verifyInstalled('tool/example', '1.0.0'); const blob = join(root, 'blobs', receipt.artifactDigest.slice(7)); await writeFile(blob, 'tampered')
    await assert.rejects(() => store.verifyInstalled('tool/example', '1.0.0'), /integrity/)
    await assert.rejects(() => store.install(plan('1.0.0', 'trusted'), source, at), /different blob/)
    assert.equal((await readFile(join(root, 'installations', 'tool__example', '1.0.0.json'), 'utf8')).includes(source), false)
    await state.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
