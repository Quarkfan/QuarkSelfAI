import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installInactiveClient, uninstallUnusedInactiveClient } from '../src/client-runtime/client-installation.js'
import { publishInstalledClientProcessHealthV1, recoverInstalledClientProcessHealthV1, removeInstalledClientProcessHealthV1 } from '../src/client-runtime/client-process-health.js'
import { createClientDistributionFixture } from './client-distribution-fixture.js'

const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`

test('publishes one lineage-bound local health receipt and blocks uninstall until removed', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-health-'))); const root = join(parent, 'client')
  try {
    const distribution = await createClientDistributionFixture(parent); const installation = await installInactiveClient({ installRoot: root, distributionSourcePath: distribution, clientVersion: '0.1.0', controlPlaneEndpoint: 'https://control.example.com/', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner', planVerification: { keyId: 'control.primary', publicKey } })
    const snapshot = { schemaVersion: 1 as const, installationId: installation.receipt.installationId, clientVersion: '0.1.0', installationState: 'installed-inactive' as const, worker: { schemaVersion: 1 as const, state: 'running' as const, passCount: 0, lastPassAt: null, lastDiscoveryAt: null, lastReceiptState: null, lastFailure: null, externalWritesEnabled: false as const }, externalWritesEnabled: false as const }
    const health = await publishInstalledClientProcessHealthV1(root, snapshot, new Date('2026-10-10T00:00:00Z'), 4242); assert.equal(health.pid, 4242); assert.deepEqual(await recoverInstalledClientProcessHealthV1(root), health)
    await assert.rejects(uninstallUnusedInactiveClient(root), /process health/); await assert.rejects(removeInstalledClientProcessHealthV1(root, 4243), /owner drifted/)
    await removeInstalledClientProcessHealthV1(root, 4242); await uninstallUnusedInactiveClient(root)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
