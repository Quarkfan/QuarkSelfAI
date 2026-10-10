import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installInactiveClient, uninstallUnusedInactiveClient } from '../src/client-runtime/client-installation.js'
import { inspectInstalledDshInferenceSecretV1, provisionInstalledDshInferenceSecretV1, removeInstalledDshInferenceSecretV1 } from '../src/client-runtime/client-secret-provisioning.js'
import { createClientDistributionFixture } from './client-distribution-fixture.js'

const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`

test('provisions, inspects and removes only the installed opaque DSH secret reference', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-secret-'))); const root = join(parent, 'client'); const returned: Uint8Array[] = []; const provider = { async load() { const key = new Uint8Array(32).fill(4); returned.push(key); return key } }
  try {
    const distribution = await createClientDistributionFixture(parent); const installed = await installInactiveClient({ installRoot: root, distributionSourcePath: distribution, clientVersion: '0.1.0', controlPlaneEndpoint: 'https://control.example.com/', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner', planVerification: { keyId: 'control.primary', publicKey }, dshInference: { baseUrl: 'https://inference.example/', model: 'provider/model-v1', apiKeyRef: 'secret:dsh-inference' } })
    assert.equal((await inspectInstalledDshInferenceSecretV1(root, provider)).configured, false)
    assert.equal((await removeInstalledDshInferenceSecretV1(root, provider)).configured, false)
    assert.deepEqual(await readdir(join(root, 'state')), [])
    assert.equal(returned.length, 0)
    const value = Buffer.from('private-fixture'); const receipt = await provisionInstalledDshInferenceSecretV1(root, value, provider); assert.equal(receipt.installationId, installed.receipt.installationId); assert.equal(receipt.configured, true); assert.equal(value.toString(), 'private-fixture')
    assert.equal((await inspectInstalledDshInferenceSecretV1(root, provider)).configured, true); await assert.rejects(provisionInstalledDshInferenceSecretV1(root, value, provider), /already exists/)
    assert.equal((await removeInstalledDshInferenceSecretV1(root, provider)).configured, false); assert.equal((await inspectInstalledDshInferenceSecretV1(root, provider)).configured, false)
    assert.ok(returned.every(key => key.every(byte => byte === 0))); await assert.rejects(uninstallUnusedInactiveClient(root), /durable state/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
