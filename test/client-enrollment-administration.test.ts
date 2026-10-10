import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { DeviceEnrollmentClientPortV1 } from '../src/control-plane/contracts.js'
import { assertInstalledClientEnrollmentApprovedV1, beginInstalledClientEnrollmentV1, pollInstalledClientEnrollmentV1 } from '../src/client-runtime/client-enrollment-administration.js'
import { installInactiveClient } from '../src/client-runtime/client-installation.js'
import { createClientDistributionFixture } from './client-distribution-fixture.js'

const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
const now = new Date('2026-10-10T00:00:00.000Z'); const expiresAt = '2026-10-10T01:00:00.000Z'

test('begins, resumes and approves one installed device without activating its service', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-enrollment-admin-'))); const root = join(parent, 'client'); let begins = 0; let polls = 0
  const enrollment: DeviceEnrollmentClientPortV1 = {
    async begin() { begins += 1; return { schemaVersion: 1, requestId: `enrollment.${'a'.repeat(32)}`, userCode: 'AAAA-BBBB-CCCC-DDDD', pollToken: 'A'.repeat(43), verificationPath: '/devices/activate', expiresAt, pollAfterSeconds: 5 } },
    async poll(input) { polls += 1; return { schemaVersion: 1, requestId: input.requestId, deviceId: 'device.owner', state: polls === 1 ? 'pending' : 'approved', expiresAt } },
  }
  const dependencies = { masterKeys: { async load() { return new Uint8Array(32).fill(7) } }, enrollment }
  try {
    const distribution = await createClientDistributionFixture(parent); const installed = await installInactiveClient({ installRoot: root, distributionSourcePath: distribution, clientVersion: '0.1.0', controlPlaneEndpoint: 'https://control.example.com/', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner', planVerification: { keyId: 'control.primary', publicKey } })
    await assert.rejects(assertInstalledClientEnrollmentApprovedV1(root, dependencies), /unavailable/)
    const begun = await beginInstalledClientEnrollmentV1(root, dependencies, now); assert.equal(begun.installationId, installed.receipt.installationId); assert.equal(begun.state, 'pending'); assert.equal(begun.serviceStarted, false); assert.equal(JSON.stringify(begun).includes('enrollment.'), false)
    assert.equal((await beginInstalledClientEnrollmentV1(root, dependencies, now)).userCode, begun.userCode); assert.equal(begins, 1)
    assert.equal((await pollInstalledClientEnrollmentV1(root, dependencies, now)).state, 'pending')
    assert.equal((await pollInstalledClientEnrollmentV1(root, dependencies, now)).state, 'approved')
    assert.equal((await assertInstalledClientEnrollmentApprovedV1(root, dependencies)).state, 'approved')
  } finally { await rm(parent, { recursive: true, force: true }) }
})
