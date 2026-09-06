import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ExecutorCapabilityReportV1, InactiveInstallationPlanV1 } from '../src/client-runtime/contracts.js'
import { LocalClientInstanceLeaseV1 } from '../src/client-runtime/client-instance-lease.js'
import { InactiveExecutorDiscoveryV1 } from '../src/client-runtime/discovery.js'
import { InactiveLocalClientApplicationV1 } from '../src/client-runtime/local-client-application.js'
import { openSqliteInactiveClientState } from '../src/client-runtime/sqlite-client-state.js'

const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const verifier = { verify: async () => true }; const at = new Date('2026-09-06T00:00:00.000Z'); const later = '2026-09-06T01:00:00.000Z'
const identity = { schemaVersion: 1 as const, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', publicKey: 'public.opaque', keyAlgorithm: 'ed25519' as const, createdAt: at.toISOString(), attestation: { kind: 'self' as const, reference: 'attestation.opaque' } }
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`

test('composes one recoverable inactive client owner with discovery and artifact state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-app-')); const databasePath = join(directory, 'client.sqlite3'); const artifactRoot = join(directory, 'artifacts'); const instanceLeasePath = join(directory, 'runtime', 'owner.lock')
  const paths = { databasePath, migrationPath: migration, artifactRoot, instanceLeasePath }; const source = join(directory, 'artifact.bin'); await writeFile(source, 'fixture')
  try {
    const state = await openSqliteInactiveClientState(databasePath, migration, verifier); state.enroll(identity, 'secret:device.owner'); await state.close()
    let app = await InactiveLocalClientApplicationV1.open(paths, verifier, at)
    assert.deepEqual(app.snapshot(at), { deviceId: identity.deviceId, connection: 'disconnected', registeredCapabilities: 0, activeCapabilities: 0, ownedConsumers: 0, ownedProviders: 0, ownedSchedulers: 0, externalWritesEnabled: false })
    await assert.rejects(() => InactiveLocalClientApplicationV1.open(paths, verifier, at), /another local client instance/)
    const report: ExecutorCapabilityReportV1 = { schemaVersion: 1, deviceId: identity.deviceId, executorId: 'executor-a', availability: 'ready', version: '1.0.0', protocolVersions: ['envelope.v1'], capabilities: ['tool.execute'], constraints: ['local-only'], discoveredAt: at.toISOString(), expiresAt: later }
    await app.refreshExecutors(new InactiveExecutorDiscoveryV1([{ executorId: 'executor-a', inspect: async () => report }]), at)
    const plan: InactiveInstallationPlanV1 = { schemaVersion: 1, planId: 'plan.install', deviceId: identity.deviceId, capabilityId: 'tool/example', version: '1.0.0', artifactDigest: digest('fixture'), isolation: 'process', lifecycleHandler: 'lifecycle.install', requiredApproval: 'install', targetState: 'installed-inactive', loadAllowed: false, runAllowed: false, externalWritesEnabled: false, createdAt: at.toISOString() }
    await app.artifacts.install(plan, source, at); assert.equal(app.snapshot(at).registeredCapabilities, 1)
    await app.close(); assert.throws(() => app.snapshot(at), /closed/)
    app = await InactiveLocalClientApplicationV1.open(paths, verifier, at)
    assert.deepEqual({ installed: app.recovery.installedVersionCount, selected: app.recovery.selectedCapabilityCount, effects: app.recovery.effects }, { installed: 1, selected: 1, effects: 'disabled' })
    await app.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('reclaims only a well-formed lease whose process is no longer alive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-lease-')); const path = join(directory, 'owner.lock')
  try {
    await mkdir(path); await writeFile(join(path, 'owner.json'), JSON.stringify({ schemaVersion: 1, pid: 2147483647, token: '00000000-0000-4000-8000-000000000000', createdAt: at.toISOString() }))
    const lease = await LocalClientInstanceLeaseV1.acquire(path, at); await lease.release()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
