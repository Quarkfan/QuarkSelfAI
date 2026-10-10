import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import test, { type TestContext } from 'node:test'
import { provisionInactiveServerConfiguration } from '../src/control-plane/server-configuration.js'
import { sealServerDistribution } from '../src/control-plane/server-distribution.js'
import { installInactiveServer } from '../src/control-plane/server-installation.js'
import { bootstrapInstalledFirstOwner } from '../src/control-plane/server-owner-bootstrap.js'
import { prepareInstalledServerUserService } from '../src/control-plane/server-service.js'
import { activateInstalledServerUserServiceV1, deactivateInstalledServerUserServiceV1, reconcileInstalledServerUserServiceActivationV1, recoverInstalledServerUserServiceActivationV1, type ServerUserServiceManagerV1 } from '../src/control-plane/server-service-activation.js'

const run = promisify(execFile); const migrations = ['001_tenant_identity.sql','002_agent_studio.sql','003_capability_registry.sql','004_device_sessions.sql','005_device_enrollment.sql','006_cloud_identity.sql','007_identity_administration.sql']; const sourceMigrations = new URL('../migrations/control-plane-sqlite/', import.meta.url).pathname

class MemoryManager implements ServerUserServiceManagerV1 {
  readonly platform = 'launchd-user' as const; installed = false; registered = false; running = false; failStart = false; failStop = false; failRemove = false
  async installDefinition(): Promise<void> { this.installed = true }
  async register(): Promise<void> { this.registered = true }
  async start(): Promise<void> { if (this.failStart) throw new Error('synthetic start failure'); this.running = true }
  async inspect(): Promise<{ registered: boolean; running: boolean }> { return { registered: this.registered, running: this.running } }
  async stopAndUnregister(): Promise<void> { if (this.failStop) throw new Error('synthetic stop failure'); this.running = false; this.registered = false }
  async removeDefinition(): Promise<void> { if (this.failRemove) throw new Error('synthetic remove failure'); this.installed = false }
}

test('commits service activation only after manager and pinned health agree, then deactivates without deleting state', async t => {
  const fixture = await setup(t); if (!fixture) return; const manager = new MemoryManager(); const target = join(fixture.parent, 'com.quarkfan.quark-server.plist')
  try {
    const receipt = await activateInstalledServerUserServiceV1({ installRoot: fixture.install, definitionTargetPath: target }, manager, new Date('2026-10-10T00:00:00Z'), health(fixture))
    assert.equal(receipt.state, 'service-active-effects-off'); assert.equal(receipt.externalEffectsEnabled, false); assert.equal(receipt.singleProvider, true)
    assert.deepEqual(await recoverInstalledServerUserServiceActivationV1(fixture.install, manager), receipt)
    await deactivateInstalledServerUserServiceV1(fixture.install, manager); assert.deepEqual(await manager.inspect(), { registered: false, running: false }); assert.equal(await readFile(join(fixture.install, 'state/control.sqlite3')).then(bytes => bytes.length > 0), true)
  } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

test('rolls registration back when start or health fails and leaves no active receipt', async t => {
  const fixture = await setup(t); if (!fixture) return; const manager = new MemoryManager(); manager.failStart = true; const target = join(fixture.parent, 'com.quarkfan.quark-server.plist')
  try { await assert.rejects(activateInstalledServerUserServiceV1({ installRoot: fixture.install, definitionTargetPath: target }, manager, new Date(), health(fixture)), /synthetic start failure/); assert.deepEqual(await manager.inspect(), { registered: false, running: false }); assert.equal(manager.installed, false); await assert.rejects(recoverInstalledServerUserServiceActivationV1(fixture.install, manager), /receipt is missing/) } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

test('preserves the definition and durable intent when unregister rollback fails', async t => {
  const fixture = await setup(t); if (!fixture) return; const manager = new MemoryManager(); manager.failStart = true; manager.failStop = true; const target = join(fixture.parent, 'com.quarkfan.quark-server.plist')
  try { await assert.rejects(activateInstalledServerUserServiceV1({ installRoot: fixture.install, definitionTargetPath: target }, manager, new Date(), health(fixture)), /rollback is incomplete/); assert.equal(manager.installed, true); assert.equal(manager.registered, true) } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

test('reconciles a completed receipt and rejects a second activation owner', async t => {
  const fixture = await setup(t); if (!fixture) return; const manager = new MemoryManager(); const input = { installRoot: fixture.install, definitionTargetPath: join(fixture.parent, 'com.quarkfan.quark-server.plist') }
  try { const receipt = await activateInstalledServerUserServiceV1(input, manager, new Date(), health(fixture)); assert.deepEqual(await reconcileInstalledServerUserServiceActivationV1(input, manager, new Date(), health(fixture)), receipt); await assert.rejects(activateInstalledServerUserServiceV1(input, manager, new Date(), health(fixture)), /already active/) } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

test('resumes deactivation after a definition removal failure without requiring the service to still run', async t => {
  const fixture = await setup(t); if (!fixture) return; const manager = new MemoryManager(); const input = { installRoot: fixture.install, definitionTargetPath: join(fixture.parent, 'com.quarkfan.quark-server.plist') }
  try { await activateInstalledServerUserServiceV1(input, manager, new Date(), health(fixture)); manager.failRemove = true; await assert.rejects(deactivateInstalledServerUserServiceV1(fixture.install, manager), /synthetic remove failure/); assert.deepEqual(await manager.inspect(), { registered: false, running: false }); manager.failRemove = false; await deactivateInstalledServerUserServiceV1(fixture.install, manager); assert.equal(manager.installed, false) } finally { await rm(fixture.parent, { recursive: true, force: true }) }
})

function health(fixture: { installationId: string; configurationDigest: string }) { return async () => ({ schemaVersion: 1 as const, state: 'ready-effects-off' as const, protocol: 'TLSv1.3' as const, providerOwnership: 'single-shared-host' as const, externalEffectsEnabled: false as const, installationId: fixture.installationId, configurationDigest: fixture.configurationDigest, checkedAt: '2026-10-10T00:00:00Z' }) }

async function setup(t: TestContext): Promise<{ parent: string; install: string; installationId: string; configurationDigest: string } | undefined> {
  const parent = await realpath(await mkdtemp(join(await realpath('/tmp'), 'qsp-active-'))); await chmod(parent, 0o700); const distribution = join(parent, 'distribution'); const install = join(parent, 'installed'); const key = join(parent, 'key.pem'); const cert = join(parent, 'cert.pem')
  try {
    try { await run('/usr/bin/openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=127.0.0.1','-days','1'], { timeout: 10_000 }) } catch { t.skip('host openssl is unavailable'); await rm(parent, { recursive: true, force: true }); return }
    await chmod(key, 0o600); await chmod(cert, 0o600); await distributionFixture(distribution); await installInactiveServer(install, distribution); const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
    const configuration = await provisionInactiveServerConfiguration({ installRoot: install, tlsKeySourcePath: key, tlsCertSourcePath: cert, host: '127.0.0.1', port: 8443, requestTimeoutMs: 5_000, maxConnections: 100, sshRequestTimeoutMs: 5_000, planVerification: { keyId: 'control.primary', publicKey } }); const owner = await bootstrapInstalledFirstOwner({ installRoot: install, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }, 'synthetic-password')
    await prepareInstalledServerUserService({ installRoot: install, platform: 'launchd-user', nodeExecutable: process.execPath, stdoutPath: join(parent, 'server.out'), stderrPath: join(parent, 'server.err') }); return { parent, install, installationId: owner.installationId, configurationDigest: configuration.configDigest }
  } catch (error) { await rm(parent, { recursive: true, force: true }); throw error }
}

async function distributionFixture(root: string): Promise<void> { await mkdir(root, { mode: 0o700 }); const ordinary = ['dist/control-plane/cloud-server-entry.js','dist/control-plane/server-admin-entry.js','dist/client-runtime/ssh-subsystem-entry.js','package.json','sbom.spdx.json']; for (const path of ordinary) { const target = join(root, 'program', path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, `fixture:${path}\n`, { mode: 0o600 }) }; for (const path of ['deploy/launchd/com.quarkfan.quark-server.plist.template','deploy/systemd/quark-server.service.template']) { const target = join(root, 'program', path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, await readFile(new URL(`../${path}`, import.meta.url)), { mode: 0o600 }) }; for (const name of migrations) { const target = join(root, 'program/migrations/control-plane-sqlite', name); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, await readFile(join(sourceMigrations, name)), { mode: 0o600 }) }; await sealServerDistribution(await realpath(root), '0.1.0', 'a'.repeat(40)) }
