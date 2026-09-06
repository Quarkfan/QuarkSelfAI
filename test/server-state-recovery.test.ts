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
import { bootstrapInstalledFirstOwner, recoverInstalledFirstOwner } from '../src/control-plane/server-owner-bootstrap.js'
import { createInactiveServerStateBundle, prepareInactiveServerStateRestore, stageInactiveServerStateBundle, verifyStagedInactiveServerStateBundle } from '../src/control-plane/server-state-recovery.js'

const run = promisify(execFile)
const migrationNames = ['001_tenant_identity.sql','002_agent_studio.sql','003_capability_registry.sql','004_device_sessions.sql','005_device_enrollment.sql','006_cloud_identity.sql','007_identity_administration.sql']
const sourceMigrations = new URL('../migrations/control-plane-sqlite/', import.meta.url).pathname

test('encrypts verified installed state and restores it only into a fresh inactive installation', async t => {
  const fixture = await setup(t); if (!fixture) return
  const { parent, source, target, mismatch, fakeAge, identity } = fixture; const encrypted = join(parent, 'server-state.age'); const staged = join(parent, 'staged')
  try {
    const created = await createInactiveServerStateBundle({ installRoot: source, outputPath: encrypted, recipient: 'age1synthetic', binaries: { age: fakeAge } }, new Date('2026-09-06T00:00:00.000Z'))
    assert.equal(created.restorePolicy.externalEffectsEnabled, false); assert.equal(Buffer.from(await readFile(encrypted)).subarray(0, 22).toString(), 'age-encryption.org/v1\n')
    const stagedDocument = await stageInactiveServerStateBundle({ inputPath: encrypted, outputDirectory: staged, identityFile: identity, binaries: { age: fakeAge } })
    assert.deepEqual(stagedDocument, created); assert.deepEqual(await verifyStagedInactiveServerStateBundle(staged), created)
    await assert.rejects(prepareInactiveServerStateRestore({ stagingDirectory: staged, installRoot: mismatch }), /distribution does not match/)
    const restored = await prepareInactiveServerStateRestore({ stagingDirectory: staged, installRoot: target }); assert.equal(restored.bundleId, created.bundleId); assert.equal(restored.state, 'owner-restored-inactive'); assert.equal(restored.autoStart, false)
    const owner = await recoverInstalledFirstOwner(target); assert.equal(owner.tenantId, 'tenant.alpha'); assert.equal(owner.userId, 'owner'); assert.equal(owner.externalEffectsEnabled, false)
    await assert.rejects(prepareInactiveServerStateRestore({ stagingDirectory: staged, installRoot: target }), /empty runtime and state/); assert.equal((await recoverInstalledFirstOwner(target)).tenantId, 'tenant.alpha')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('detects staged database drift before restore', async t => {
  const fixture = await setup(t); if (!fixture) return
  const { parent, source, fakeAge, identity } = fixture; const encrypted = join(parent, 'server-state.age'); const staged = join(parent, 'staged')
  try { await createInactiveServerStateBundle({ installRoot: source, outputPath: encrypted, recipient: 'age1synthetic', binaries: { age: fakeAge } }); await stageInactiveServerStateBundle({ inputPath: encrypted, outputDirectory: staged, identityFile: identity, binaries: { age: fakeAge } }); await writeFile(join(staged, 'state/control.sqlite3'), 'tampered', { mode: 0o600 }); await assert.rejects(verifyStagedInactiveServerStateBundle(staged), /digest drifted/) } finally { await rm(parent, { recursive: true, force: true }) }
})

async function setup(t: TestContext): Promise<{ parent: string; source: string; target: string; mismatch: string; fakeAge: string; identity: string } | undefined> {
  const created = await mkdtemp(join(await realpath('/tmp'), 'qsr-')); await chmod(created, 0o700); const parent = await realpath(created); const distribution = join(parent, 'distribution'); const mismatchDistribution = join(parent, 'mismatch-distribution'); const source = join(parent, 'source'); const target = join(parent, 'target'); const mismatch = join(parent, 'mismatch'); const keyPath = join(parent, 'tls-key.pem'); const certPath = join(parent, 'tls-cert.pem')
  try {
    try { await run('/usr/bin/openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-subj','/CN=127.0.0.1','-days','1'], { timeout: 10_000 }) } catch { t.skip('host openssl is unavailable'); await rm(parent, { recursive: true, force: true }); return }
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600); await makeDistribution(distribution, 'a'.repeat(40)); await makeDistribution(mismatchDistribution, 'b'.repeat(40)); await installInactiveServer(source, distribution); await installInactiveServer(target, distribution); await installInactiveServer(mismatch, mismatchDistribution)
    const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
    for (const installRoot of [source, target, mismatch]) await provisionInactiveServerConfiguration({ installRoot, tlsKeySourcePath: keyPath, tlsCertSourcePath: certPath, host: '127.0.0.1', port: 8443, requestTimeoutMs: 5_000, maxConnections: 100, sshRequestTimeoutMs: 5_000, planVerification: { keyId: 'control.primary', publicKey } })
    await bootstrapInstalledFirstOwner({ installRoot: source, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }, 'synthetic-password', new Date('2026-09-06T00:00:00.000Z'))
    const fakeAge = join(parent, 'fake-age.mjs'); await writeFile(fakeAge, `#!/usr/bin/env node\nimport { readFile, writeFile } from 'node:fs/promises'\nconst a=process.argv.slice(2);if(a[0]==='-r'){const o=a[a.indexOf('-o')+1],i=a.at(-1);await writeFile(o,Buffer.concat([Buffer.from('age-encryption.org/v1\\n'),await readFile(i)]))}else if(a[0]==='-d'){const o=a[a.indexOf('-o')+1],i=a.at(-1),b=await readFile(i);await writeFile(o,b.subarray(22))}else process.exit(2)\n`, { mode: 0o700 }); await chmod(fakeAge, 0o700)
    const identity = join(parent, 'identity.txt'); await writeFile(identity, 'synthetic\n', { mode: 0o600 }); return { parent, source, target, mismatch, fakeAge, identity }
  } catch (error) { await rm(parent, { recursive: true, force: true }); throw error }
}

async function makeDistribution(root: string, revision: string): Promise<void> { await mkdir(root, { mode: 0o700 }); const files = ['dist/control-plane/cloud-server-entry.js','dist/control-plane/server-admin-entry.js','dist/client-runtime/ssh-subsystem-entry.js','package.json','sbom.spdx.json']; for (const path of files) { const target = join(root, 'program', path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, `fixture:${path}\n`, { mode: 0o600 }) }; for (const name of migrationNames) { const target = join(root, 'program/migrations/control-plane-sqlite', name); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, await readFile(join(sourceMigrations, name)), { mode: 0o600 }) }; await sealServerDistribution(await realpath(root), '0.1.0', revision) }
