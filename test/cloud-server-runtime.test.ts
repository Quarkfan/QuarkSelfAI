import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { bootstrapFirstCloudOwnerV1 } from '../src/control-plane/cloud-owner-bootstrap.js'
import { openPreparedCloudServerRuntimeV1 } from '../src/control-plane/cloud-server-runtime.js'

const run = promisify(execFile)
const migration = (name: string) => new URL(`../migrations/control-plane-sqlite/${name}`, import.meta.url).pathname
const migrations = { tenant: migration('001_tenant_identity.sql'), studio: migration('002_agent_studio.sql'), capability: migration('003_capability_registry.sql'), deviceSession: migration('004_device_sessions.sql'), deviceEnrollment: migration('005_device_enrollment.sql'), identity: migration('006_cloud_identity.sql'), identityAdministration: migration('007_identity_administration.sql') }

test('opens and closes TLS and SSH IPC around one cloud provider host', async t => {
  const created = await mkdtemp(join(tmpdir(), 'quark-cloud-runtime-')); await chmod(created, 0o700); const root = await realpath(created)
  const databasePath = join(root, 'control.sqlite3'); const socketPath = join(root, 'device.sock'); const keyPath = join(root, 'key.pem'); const certPath = join(root, 'cert.pem')
  let runtime: Awaited<ReturnType<typeof openPreparedCloudServerRuntimeV1>> | undefined
  try {
    try { await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=127.0.0.1', '-days', '1'], { timeout: 10_000 }) } catch { t.skip('host openssl is unavailable'); return }
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600)
    await bootstrapFirstCloudOwnerV1({ schemaVersion: 1, databasePath, tenantMigrationPath: migrations.tenant, identityMigrationPath: migrations.identity, tenantId: 'tenant.runtime', tenantName: 'Runtime', userId: 'owner', displayName: 'Owner' }, 'synthetic-password', new Date('2026-09-06T00:00:00.000Z'))
    const config = makeConfig(databasePath, socketPath); const credentials = { key: await readFile(keyPath), cert: await readFile(certPath) }; let token = 0
    const dependencies = { tokens: { next: (label: 'challenge' | 'nonce' | 'session' | 'lease') => `${label}.${++token}` }, proofVerifier: { async verify() { return true } }, planVerifier: { async verify() { return true } } }
    try { await openPreparedCloudServerRuntimeV1(config, { key: Buffer.from('not-pem'), cert: Buffer.from('not-pem') }, dependencies) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit listeners'); return }; assert.match(String(error), /credentials are invalid/) }
    await assert.rejects(lstat(socketPath), error => (error as NodeJS.ErrnoException).code === 'ENOENT')
    runtime = await openPreparedCloudServerRuntimeV1(config, credentials, dependencies)
    const result = await post(runtime.tls.port, '/v1/auth/login', { tenantId: 'tenant.runtime', userId: 'owner', password: 'synthetic-password' })
    assert.equal(result.status, 201); assert.equal((JSON.parse(result.body) as { code: string }).code, 'created')
    assert.deepEqual({ ownership: runtime.providerOwnership, tlsRequests: runtime.tls.requestCount(), sshRequests: runtime.sshIpc.requestCount() }, { ownership: 'single-shared-host', tlsRequests: 1, sshRequests: 0 })
    await runtime.close(); runtime = undefined; await assert.rejects(lstat(socketPath), error => (error as NodeJS.ErrnoException).code === 'ENOENT')
  } finally { if (runtime) await runtime.close(); await rm(root, { recursive: true, force: true }) }
})

function makeConfig(databasePath: string, socketPath: string) { return { schemaVersion: 1, host: { schemaVersion: 1, composition: { schemaVersion: 1, databasePath, migrations, listenerEnabled: false, externalEffectsEnabled: false }, directTls: 'prepared-inactive', sshSubsystem: 'prepared-inactive', singleProvider: true, activationAllowed: false }, tls: { schemaVersion: 1, enabled: true, host: '127.0.0.1', port: 0, requestTimeoutMs: 2_000, maxConnections: 4, providerOwnership: 'shared-host', externalEffectsEnabled: false }, sshIpc: { schemaVersion: 1, enabled: true, socketPath, requestTimeoutMs: 2_000, providerOwnership: 'shared-host', externalEffectsEnabled: false }, singleProvider: true, externalEffectsEnabled: false } as const }
function post(port: number, path: string, body: unknown): Promise<{ status: number; body: string }> { return new Promise((resolve, reject) => { const payload = JSON.stringify(body); const call = request({ hostname: '127.0.0.1', port, path, method: 'POST', rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, response => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })) }); call.once('error', reject); call.end(payload) }) }
