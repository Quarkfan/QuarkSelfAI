import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'
import { TLSSocket } from 'node:tls'
import { recoverInactiveServerConfiguration } from './server-configuration.js'

export interface PinnedTlsCloudServerHealthInputV1 {
  readonly host: string
  readonly port: number
  readonly certificate: Buffer
  readonly timeoutMs: number
}

export interface PinnedTlsCloudServerHealthReceiptV1 {
  readonly schemaVersion: 1
  readonly state: 'ready-effects-off'
  readonly protocol: 'TLSv1.3'
  readonly providerOwnership: 'single-shared-host'
  readonly externalEffectsEnabled: false
}

export interface InstalledCloudServerHealthReceiptV1 extends PinnedTlsCloudServerHealthReceiptV1 {
  readonly installationId: string
  readonly configurationDigest: string
  readonly checkedAt: string
}

/** Verifies the bounded health response over TLS pinned to the installed certificate. */
export async function probePinnedTlsCloudServerHealthV1(input: PinnedTlsCloudServerHealthInputV1): Promise<PinnedTlsCloudServerHealthReceiptV1> {
  validate(input)
  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, value?: PinnedTlsCloudServerHealthReceiptV1): void => {
      if (settled) return
      settled = true
      if (error) reject(error); else resolve(value!)
    }
    const call = request({ hostname: input.host, port: input.port, path: '/v1/health', method: 'GET', ca: input.certificate, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', timeout: input.timeoutMs, headers: { accept: 'application/json' } }, response => {
      const protocol = response.socket instanceof TLSSocket ? response.socket.getProtocol() : null; const chunks: Buffer[] = []; let size = 0
      response.on('data', chunk => { const bytes = Buffer.from(chunk); size += bytes.byteLength; if (size > 4_096) { response.destroy(); finish(new Error('cloud server health response is too large')); return }; chunks.push(bytes) })
      response.once('error', error => finish(error instanceof Error ? error : new Error('cloud server health response failed')))
      response.once('end', () => {
        try {
          if (response.statusCode !== 200 || response.headers['content-type'] !== 'application/json' || protocol !== 'TLSv1.3') throw new Error('cloud server health response is invalid')
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
          if (!record(value) || Object.keys(value).sort().join(',') !== ['code','state','providerOwnership','externalEffectsEnabled'].sort().join(',') || value.code !== 'ok' || value.state !== 'ready' || value.providerOwnership !== 'single-shared-host' || value.externalEffectsEnabled !== false) throw new Error('cloud server health response is invalid')
          finish(undefined, Object.freeze({ schemaVersion: 1, state: 'ready-effects-off', protocol: 'TLSv1.3', providerOwnership: 'single-shared-host', externalEffectsEnabled: false }))
        } catch (error) { finish(error instanceof Error ? error : new Error('cloud server health response is invalid')) }
      })
    })
    call.once('timeout', () => call.destroy(new Error('cloud server health probe timed out')))
    call.once('error', error => finish(error))
    call.end()
  })
}

/** Resolves one installed endpoint and certificate, then performs the pinned effects-off probe. */
export async function probeInstalledCloudServerHealthV1(installRoot: string, now = new Date()): Promise<InstalledCloudServerHealthReceiptV1> {
  if (!isAbsolute(installRoot) || resolve(installRoot) !== installRoot || installRoot === '/' || await realpath(installRoot) !== installRoot || Number.isNaN(now.getTime())) throw new Error('installed cloud server health input is invalid')
  const configuration = await recoverInactiveServerConfiguration(installRoot)
  const serverBytes = await readPrivate(join(installRoot, 'config/server.json'), 64 * 1024); const certificate = await readPrivate(join(installRoot, 'config/tls-cert.pem'), 65_536)
  try {
    if (digest(serverBytes) !== configuration.configDigest || digest(certificate) !== configuration.tlsCertDigest) throw new Error('installed cloud server health configuration drifted')
    const server = JSON.parse(serverBytes.toString('utf8')) as { runtime?: { tls?: { host?: unknown; port?: unknown; requestTimeoutMs?: unknown } } }; const tls = server.runtime?.tls
    if (!tls || typeof tls.host !== 'string' || typeof tls.port !== 'number' || typeof tls.requestTimeoutMs !== 'number') throw new Error('installed cloud server health configuration is invalid')
    const health = await probePinnedTlsCloudServerHealthV1({ host: tls.host, port: tls.port, certificate, timeoutMs: tls.requestTimeoutMs })
    return Object.freeze({ ...health, installationId: configuration.installationId, configurationDigest: configuration.configDigest, checkedAt: now.toISOString() })
  } finally { certificate.fill(0) }
}

function validate(input: PinnedTlsCloudServerHealthInputV1): void {
  if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== ['host','port','certificate','timeoutMs'].sort().join(',') || !isIP(input.host) || !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65_535 || !Buffer.isBuffer(input.certificate) || input.certificate.byteLength < 1 || input.certificate.byteLength > 65_536 || !input.certificate.toString('ascii').includes('CERTIFICATE-----') || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 30_000) throw new Error('cloud server health probe input is invalid')
}
async function readPrivate(path: string, max: number): Promise<Buffer> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || state.size < 1 || state.size > max || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('installed cloud server health file is unsafe'); return await readFile(path) }
function digest(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
