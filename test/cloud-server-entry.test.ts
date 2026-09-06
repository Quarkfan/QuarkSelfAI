import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmod, lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { bootstrapFirstCloudOwnerV1 } from '../src/control-plane/cloud-owner-bootstrap.js'

const run = promisify(execFile)
const migration = (name: string) => new URL(`../migrations/control-plane-sqlite/${name}`, import.meta.url).pathname
const migrations = { tenant: migration('001_tenant_identity.sql'), studio: migration('002_agent_studio.sql'), capability: migration('003_capability_registry.sql'), deviceSession: migration('004_device_sessions.sql'), deviceEnrollment: migration('005_device_enrollment.sql'), identity: migration('006_cloud_identity.sql'), identityAdministration: migration('007_identity_administration.sql') }

test('runs the built cloud server entry until a graceful signal', async t => {
  const created = await mkdtemp(join(tmpdir(), 'quark-cloud-entry-')); await chmod(created, 0o700); const root = await realpath(created)
  const databasePath = join(root, 'control.sqlite3'); const socketPath = join(root, 'device.sock'); const keyPath = join(root, 'key.pem'); const certPath = join(root, 'cert.pem'); const configPath = join(root, 'server.json')
  try {
    try { await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=127.0.0.1', '-days', '1'], { timeout: 10_000 }) } catch { t.skip('host openssl is unavailable'); return }
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600)
    await bootstrapFirstCloudOwnerV1({ schemaVersion: 1, databasePath, tenantMigrationPath: migrations.tenant, identityMigrationPath: migrations.identity, tenantId: 'tenant.entry', tenantName: 'Entry', userId: 'owner', displayName: 'Owner' }, 'synthetic-password')
    const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
    await writeFile(configPath, `${JSON.stringify({ schemaVersion: 1, runtime: { schemaVersion: 1, host: { schemaVersion: 1, composition: { schemaVersion: 1, databasePath, migrations, listenerEnabled: false, externalEffectsEnabled: false }, directTls: 'prepared-inactive', sshSubsystem: 'prepared-inactive', singleProvider: true, activationAllowed: false }, tls: { schemaVersion: 1, enabled: true, host: '127.0.0.1', port: 0, requestTimeoutMs: 2_000, maxConnections: 4, providerOwnership: 'shared-host', externalEffectsEnabled: false }, sshIpc: { schemaVersion: 1, enabled: true, socketPath, requestTimeoutMs: 2_000, providerOwnership: 'shared-host', externalEffectsEnabled: false }, singleProvider: true, externalEffectsEnabled: false }, tlsCredentials: { keyPath, certPath }, planVerification: { keyId: 'control.primary', publicKey } })}\n`, { mode: 0o600 })
    const disabled = await run(process.execPath, ['dist/control-plane/cloud-server-entry.js', 'run', configPath], { cwd: new URL('..', import.meta.url).pathname }).catch(error => error as { stdout: string; stderr: string; code: number })
    assert.deepEqual({ stdout: disabled.stdout, stderr: disabled.stderr, code: disabled.code }, { stdout: '', stderr: 'Cloud server failed: startup-or-runtime-failure\n', code: 1 })
    const child = spawn(process.execPath, ['dist/control-plane/cloud-server-entry.js', 'run', configPath], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, QUARK_CLOUD_SERVER_ENABLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const completion = collect(child)
    try { try { await waitForReady(child) } catch (error) { const result = await completion; if (result.code === 1 && result.stdout === '' && result.stderr === 'Cloud server failed: startup-or-runtime-failure\n') { t.skip('sandbox does not permit listeners'); return }; throw error }; assert.equal((await lstat(socketPath)).isSocket(), true); child.kill('SIGTERM'); const result = await completion; assert.deepEqual(result, { code: 0, stdout: '{"schemaVersion":1,"state":"ready","transport":"tls+ssh","externalEffectsEnabled":false}\n', stderr: '' }); await assert.rejects(lstat(socketPath), error => (error as NodeJS.ErrnoException).code === 'ENOENT') }
    finally { if (child.exitCode === null) child.kill('SIGTERM') }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit listeners'); return }; throw error }
  finally { await rm(root, { recursive: true, force: true }) }
})

function waitForReady(child: ReturnType<typeof spawn>): Promise<void> { return new Promise((resolve, reject) => { const cleanup = (): void => { clearTimeout(timeout); child.stdout!.off('data', ready); child.off('exit', exited) }; const ready = (chunk: Buffer): void => { if (chunk.toString().includes('"state":"ready"')) { cleanup(); resolve() } }; const exited = (): void => { cleanup(); reject(new Error('cloud server entry exited before ready')) }; const timeout = setTimeout(() => { cleanup(); reject(new Error('cloud server entry did not become ready')) }, 5_000); child.stdout!.on('data', ready); child.once('exit', exited) }) }
function collect(child: ReturnType<typeof spawn>): Promise<{ code: number | null; stdout: string; stderr: string }> { return new Promise((resolve, reject) => { const stdout: Buffer[] = []; const stderr: Buffer[] = []; child.stdout!.on('data', chunk => stdout.push(Buffer.from(chunk))); child.stderr!.on('data', chunk => stderr.push(Buffer.from(chunk))); child.once('error', reject); child.once('exit', code => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() })) }) }
