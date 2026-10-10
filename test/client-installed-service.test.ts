import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installInactiveClient, uninstallUnusedInactiveClient } from '../src/client-runtime/client-installation.js'
import { prepareInstalledClientUserServiceV1, recoverPreparedClientUserServiceV1, removeUnregisteredClientUserServiceV1 } from '../src/client-runtime/client-installed-service.js'
import { createClientDistributionFixture } from './client-distribution-fixture.js'

const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
function installInput(installRoot: string, distributionSourcePath: string) { return { installRoot, distributionSourcePath, clientVersion: '0.1.0', controlPlaneEndpoint: 'https://control.example.com/', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner', planVerification: { keyId: 'control.primary', publicKey } } }
function serviceInput(installRoot: string) { return { installRoot, platform: 'launchd-user' as const, nodeExecutable: '/opt/node/bin/node', workspacePath: '/Users/test/Workspace', stdoutPath: join(installRoot, 'runtime/client.stdout.log'), stderrPath: join(installRoot, 'runtime/client.stderr.log'), executablePath: '/opt/node/bin:/usr/bin:/bin' } }

test('persists and recovers one sealed inactive client service without registering it', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-service-'))); const root = join(parent, 'client')
  try {
    const distribution = await createClientDistributionFixture(parent); const installed = await installInactiveClient(installInput(root, distribution))
    const prepared = await prepareInstalledClientUserServiceV1(serviceInput(root), new Date('2026-10-10T00:00:00.000Z'))
    assert.equal(prepared.installationId, installed.receipt.installationId); assert.equal(prepared.state, 'service-prepared-inactive')
    assert.equal(prepared.registered, false); assert.equal(prepared.started, false); assert.equal(prepared.externalWritesEnabled, false)
    assert.deepEqual(await recoverPreparedClientUserServiceV1(root), prepared)
    const definition = await readFile(join(root, 'service/com.quarkfan.quark-client.plist'), 'utf8')
    assert.match(definition, /QUARK_CLIENT_ENABLE_NO_EFFECT_WORKER/); assert.doesNotMatch(definition, /API_KEY|TOKEN|PASSWORD|PRIVATE_KEY/)
    await assert.rejects(uninstallUnusedInactiveClient(root), /service preparation/)
    assert.equal((await removeUnregisteredClientUserServiceV1(root)).definitionDigest, prepared.definitionDigest)
    assert.equal((await uninstallUnusedInactiveClient(root)).installationId, installed.receipt.installationId)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('rejects preparation and installed definition drift without deleting evidence', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-service-'))); const root = join(parent, 'client')
  try {
    const distribution = await createClientDistributionFixture(parent); await installInactiveClient(installInput(root, distribution)); await prepareInstalledClientUserServiceV1(serviceInput(root))
    await assert.rejects(prepareInstalledClientUserServiceV1(serviceInput(root)), /already exists/)
    const definitionPath = join(root, 'service/com.quarkfan.quark-client.plist'); const original = await readFile(definitionPath, 'utf8'); await writeFile(definitionPath, `${original}\n<!-- drift -->\n`, { mode: 0o600 })
    await assert.rejects(recoverPreparedClientUserServiceV1(root), /digest drifted/)
    await assert.rejects(removeUnregisteredClientUserServiceV1(root), /digest drifted/)
    assert.match(await readFile(definitionPath, 'utf8'), /drift/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
