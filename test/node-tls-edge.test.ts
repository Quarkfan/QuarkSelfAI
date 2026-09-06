import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { openTlsCloudEdgeV1 } from '../src/control-plane/node-tls-edge.js'

const run = promisify(execFile)

test('serves the bounded handler through a real temporary TLS 1.3 loopback edge', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quark-tls-edge-')); const keyPath = join(root, 'key.pem'); const certPath = join(root, 'cert.pem')
  let edge: Awaited<ReturnType<typeof openTlsCloudEdgeV1>> | undefined
  try {
    try { await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=127.0.0.1', '-days', '1'], { timeout: 10_000 }) } catch { t.skip('host openssl is unavailable'); return }
    let observed: unknown; const handler = { async handle(input: unknown) { observed = input; return { status: 200 as const, body: { code: 'ok' } } } }
    edge = await openTlsCloudEdgeV1({ schemaVersion: 1, enabled: true, host: '127.0.0.1', port: 0, requestTimeoutMs: 2_000, maxConnections: 4, providerOwnership: 'shared-host', externalEffectsEnabled: false }, { key: await readFile(keyPath), cert: await readFile(certPath) }, handler)
    const result = await get(edge.port)
    assert.deepEqual(observed, { method: 'GET', path: '/v1/health' })
    assert.deepEqual({ ...result, requests: edge.requestCount(), protocol: edge.protocol }, { status: 200, body: '{"code":"ok"}', tls: 'TLSv1.3', requests: 1, protocol: 'TLSv1.3' })
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit loopback listeners'); return }; throw error }
  finally { if (edge) await edge.close(); await rm(root, { recursive: true, force: true }) }
})

test('rejects wildcard ephemeral binds, plaintext credentials and independent provider ownership', async () => {
  const handler = { async handle() { return { status: 200 as const, body: {} } } }; const credential = Buffer.from('not-pem')
  await assert.rejects(() => openTlsCloudEdgeV1({ schemaVersion: 1, enabled: true, host: '0.0.0.0', port: 0, requestTimeoutMs: 2_000, maxConnections: 4, providerOwnership: 'shared-host', externalEffectsEnabled: false }, { key: credential, cert: credential }, handler), /config is invalid/)
  await assert.rejects(() => openTlsCloudEdgeV1({ schemaVersion: 1, enabled: true, host: '127.0.0.1', port: 0, requestTimeoutMs: 2_000, maxConnections: 4, providerOwnership: 'independent', externalEffectsEnabled: false }, { key: credential, cert: credential }, handler), /config is invalid/)
})

function get(port: number): Promise<{ status: number; body: string; tls: string | null }> { return new Promise((resolve, reject) => { const call = request({ hostname: '127.0.0.1', port, path: '/v1/health', method: 'GET', rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, response => { const chunks: Buffer[] = []; const tls = response.socket.getProtocol(); response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), tls })) }); call.once('error', reject); call.end() }) }
