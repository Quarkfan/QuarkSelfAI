import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { openTlsCloudEdgeV1 } from '../src/control-plane/node-tls-edge.js'
import { probePinnedTlsCloudServerHealthV1 } from '../src/control-plane/server-health.js'

const run = promisify(execFile)

test('accepts only the exact effects-off health response over pinned TLS 1.3', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quark-server-health-')); await chmod(root, 0o700)
  const keyPath = join(root, 'key.pem'); const certPath = join(root, 'cert.pem'); const otherKey = join(root, 'other-key.pem'); const otherCert = join(root, 'other-cert.pem')
  let edge: Awaited<ReturnType<typeof openTlsCloudEdgeV1>> | undefined; let unsafe = false
  try {
    try {
      for (const [key, cert] of [[keyPath, certPath], [otherKey, otherCert]]) await run('/usr/bin/openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-days','1'], { timeout: 10_000 })
    } catch { t.skip('host openssl is unavailable'); return }
    const handler = { async handle() { return unsafe ? { status: 200 as const, body: { code: 'ok', state: 'ready', providerOwnership: 'independent', externalEffectsEnabled: false } } : { status: 200 as const, body: { code: 'ok', state: 'ready', providerOwnership: 'single-shared-host', externalEffectsEnabled: false } } } }
    edge = await openTlsCloudEdgeV1({ schemaVersion: 1, enabled: true, host: '127.0.0.1', port: 0, requestTimeoutMs: 2_000, maxConnections: 4, providerOwnership: 'shared-host', externalEffectsEnabled: false }, { key: await readFile(keyPath), cert: await readFile(certPath) }, handler)
    assert.deepEqual(await probePinnedTlsCloudServerHealthV1({ host: edge.host, port: edge.port, certificate: await readFile(certPath), timeoutMs: 2_000 }), { schemaVersion: 1, state: 'ready-effects-off', protocol: 'TLSv1.3', providerOwnership: 'single-shared-host', externalEffectsEnabled: false })
    unsafe = true; await assert.rejects(probePinnedTlsCloudServerHealthV1({ host: edge.host, port: edge.port, certificate: await readFile(certPath), timeoutMs: 2_000 }), /response is invalid/)
    await assert.rejects(probePinnedTlsCloudServerHealthV1({ host: edge.host, port: edge.port, certificate: await readFile(otherCert), timeoutMs: 2_000 }))
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit loopback listeners'); return }; throw error }
  finally { if (edge) await edge.close(); await rm(root, { recursive: true, force: true }) }
})

test('rejects unpinned, unbounded and ambiguous health probe inputs', async () => {
  const certificate = Buffer.from('-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n')
  await assert.rejects(probePinnedTlsCloudServerHealthV1({ host: 'server.example', port: 443, certificate, timeoutMs: 2_000 }), /input is invalid/)
  await assert.rejects(probePinnedTlsCloudServerHealthV1({ host: '127.0.0.1', port: 0, certificate, timeoutMs: 2_000 }), /input is invalid/)
  await assert.rejects(probePinnedTlsCloudServerHealthV1({ host: '127.0.0.1', port: 443, certificate: Buffer.alloc(0), timeoutMs: 2_000 }), /input is invalid/)
  await assert.rejects(probePinnedTlsCloudServerHealthV1({ host: '127.0.0.1', port: 443, certificate, timeoutMs: 999 }), /input is invalid/)
})
