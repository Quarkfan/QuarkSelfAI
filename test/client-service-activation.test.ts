import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installInactiveClient } from '../src/client-runtime/client-installation.js'
import { prepareInstalledClientUserServiceV1, removeUnregisteredClientUserServiceV1 } from '../src/client-runtime/client-installed-service.js'
import { publishInstalledClientProcessHealthV1 } from '../src/client-runtime/client-process-health.js'
import { activateInstalledClientUserServiceV1, deactivateInstalledClientUserServiceV1, recoverInstalledClientUserServiceActivationV1, type ClientUserServiceManagerV1 } from '../src/client-runtime/client-service-activation.js'
import { createClientDistributionFixture } from './client-distribution-fixture.js'

const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
class MemoryManager implements ClientUserServiceManagerV1 { readonly platform = 'launchd-user' as const; installed = false; registered = false; running = false; pid: number | null = null; failStart = false; async installDefinition() { this.installed = true } async register() { this.registered = true } async start() { if (this.failStart) throw new Error('synthetic start failure'); this.running = true; this.pid = 4242 } async inspect() { return { registered: this.registered, running: this.running, pid: this.pid } } async stopAndUnregister() { this.running = false; this.registered = false; this.pid = null } async removeDefinition() { this.installed = false } }

test('commits one client service owner only after PID-bound health and deactivates in reverse order', async () => {
  const fixture = await setup(); const manager = new MemoryManager(); const input = { installRoot: fixture.root, definitionTargetPath: join(fixture.parent, 'com.quarkfan.quark-client.plist') }
  try {
    await health(fixture, 4242); const receipt = await activateInstalledClientUserServiceV1(input, manager, new Date('2026-10-10T00:00:00Z'), undefined, async () => ({ state: 'approved' }))
    assert.equal(receipt.state, 'service-active-effects-off'); assert.equal(receipt.singleClientOwner, true); assert.equal(receipt.externalWritesEnabled, false)
    assert.deepEqual(await recoverInstalledClientUserServiceActivationV1(fixture.root, manager), receipt); await assert.rejects(removeUnregisteredClientUserServiceV1(fixture.root), /activation state/)
    await deactivateInstalledClientUserServiceV1(fixture.root, manager); assert.deepEqual(await manager.inspect(), { registered: false, running: false, pid: null }); assert.equal(manager.installed, false)
  } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

test('rolls service registration and health back when startup fails', async () => {
  const fixture = await setup(); const manager = new MemoryManager(); manager.failStart = true; const input = { installRoot: fixture.root, definitionTargetPath: join(fixture.parent, 'com.quarkfan.quark-client.plist') }
  try { await health(fixture, 4242); await assert.rejects(activateInstalledClientUserServiceV1(input, manager, undefined, undefined, async () => ({ state: 'approved' })), /synthetic start failure/); assert.deepEqual(await manager.inspect(), { registered: false, running: false, pid: null }); assert.equal(manager.installed, false) } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

test('fails before service-manager mutation when device enrollment is not approved', async () => {
  const fixture = await setup(); const manager = new MemoryManager(); const input = { installRoot: fixture.root, definitionTargetPath: join(fixture.parent, 'com.quarkfan.quark-client.plist') }
  try { await assert.rejects(activateInstalledClientUserServiceV1(input, manager), /enrollment is unavailable/); assert.deepEqual(await manager.inspect(), { registered: false, running: false, pid: null }); assert.equal(manager.installed, false) } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

async function setup() { const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-active-'))); const root = join(parent, 'client'); const distribution = await createClientDistributionFixture(parent); const installation = await installInactiveClient({ installRoot: root, distributionSourcePath: distribution, clientVersion: '0.1.0', controlPlaneEndpoint: 'https://control.example.com/', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner', planVerification: { keyId: 'control.primary', publicKey } }); await prepareInstalledClientUserServiceV1({ installRoot: root, platform: 'launchd-user', nodeExecutable: process.execPath, workspacePath: parent, stdoutPath: join(parent, 'stdout.log'), stderrPath: join(parent, 'stderr.log'), executablePath: '/usr/bin:/bin' }); return { parent, root, installation } }
async function health(fixture: Awaited<ReturnType<typeof setup>>, pid: number) { return await publishInstalledClientProcessHealthV1(fixture.root, { schemaVersion: 1, installationId: fixture.installation.receipt.installationId, clientVersion: '0.1.0', installationState: 'installed-inactive', worker: { schemaVersion: 1, state: 'running', passCount: 0, lastPassAt: null, lastDiscoveryAt: null, lastReceiptState: null, lastFailure: null, externalWritesEnabled: false }, externalWritesEnabled: false }, new Date('2026-10-10T00:00:00Z'), pid) }
