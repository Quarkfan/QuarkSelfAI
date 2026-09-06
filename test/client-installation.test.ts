import assert from 'node:assert/strict'
import { access, chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installInactiveClient, recoverInactiveClientInstallation, uninstallUnusedInactiveClient } from '../src/client-runtime/client-installation.js'
import { InactiveConfiguredLocalClientV1 } from '../src/client-runtime/configured-local-client.js'

const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
function input(installRoot: string) { return { installRoot, clientVersion: '0.1.0', migrationSourcePath: migration, controlPlaneEndpoint: 'https://control.example.com/', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner' } }

test('installs, recovers and uninstalls one unused inactive client with private files', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-installer-'))); const root = join(parent, 'client')
  try {
    const installed = await installInactiveClient(input(root), new Date('2026-09-06T00:00:00.000Z'))
    assert.equal(installed.receipt.state, 'installed-inactive'); assert.equal(installed.plan.autoConnect, false)
    assert.equal((await lstat(root)).mode & 0o077, 0); assert.equal((await lstat(join(root, 'client.json'))).mode & 0o077, 0); assert.equal((await lstat(installed.plan.client.paths.migrationPath)).mode & 0o077, 0)
    const metadata = await readFile(join(root, 'client.json'), 'utf8'); assert.doesNotMatch(metadata, /master.?key|pollToken|privateKey\W*:/i)
    const recovered = await recoverInactiveClientInstallation(root); assert.deepEqual(recovered.receipt, installed.receipt)
    assert.equal((await uninstallUnusedInactiveClient(root)).installationId, installed.receipt.installationId)
    await assert.rejects(access(root))
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('fails closed on migration, receipt, layout and permission drift', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-installer-')))
  try {
    const migrationRoot = join(parent, 'migration-client'); const installed = await installInactiveClient(input(migrationRoot)); await writeFile(installed.plan.client.paths.migrationPath, 'tampered')
    await assert.rejects(recoverInactiveClientInstallation(migrationRoot), /migration digest drifted/)
    const permissionRoot = join(parent, 'permission-client'); await installInactiveClient(input(permissionRoot)); await chmod(join(permissionRoot, 'client.json'), 0o644)
    await assert.rejects(recoverInactiveClientInstallation(permissionRoot), /file is invalid/)
    const layoutRoot = join(parent, 'layout-client'); await installInactiveClient(input(layoutRoot)); await writeFile(join(layoutRoot, 'unexpected'), 'x')
    await assert.rejects(recoverInactiveClientInstallation(layoutRoot), /layout is invalid/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('never removes an installation after durable client state appears', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-installer-'))); const root = join(parent, 'client')
  try {
    const installed = await installInactiveClient(input(root))
    const client = await InactiveConfiguredLocalClientV1.initialize(installed.plan, { async verify() { return true } }, { masterKeys: { async load() { return new Uint8Array(32).fill(12) } } }); await client.close()
    await assert.rejects(uninstallUnusedInactiveClient(root), /contains durable state/); await access(root)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('cleans only its newly-created root when bootstrap validation fails', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-installer-'))); const root = join(parent, 'client')
  try {
    await assert.rejects(installInactiveClient({ ...input(root), controlPlaneEndpoint: 'http://example.com/' }), /HTTPS or explicit ephemeral/)
    await assert.rejects(access(root))
  } finally { await rm(parent, { recursive: true, force: true }) }
})
