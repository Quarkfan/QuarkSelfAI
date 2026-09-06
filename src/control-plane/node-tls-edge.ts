import { createServer, type Server } from 'node:https'
import { isIP, type AddressInfo } from 'node:net'
import type { InactiveCloudHttpHandlerV1 } from './http-handler.js'
import { routeCloudHttpRequestV1 } from './node-http-adapter.js'

export interface TlsCloudEdgeConfigV1 { readonly schemaVersion: 1; readonly enabled: true; readonly host: string; readonly port: number; readonly requestTimeoutMs: number; readonly maxConnections: number; readonly providerOwnership: 'shared-host'; readonly externalEffectsEnabled: false }
export interface TlsCloudEdgeV1 { readonly host: string; readonly port: number; readonly protocol: 'TLSv1.3'; requestCount(): number; close(): Promise<void> }

/** Explicit TLS edge around an existing handler. It never constructs providers or enables effects. */
export async function openTlsCloudEdgeV1(value: unknown, credentials: { readonly key: Buffer; readonly cert: Buffer }, handler: Pick<InactiveCloudHttpHandlerV1, 'handle'>): Promise<TlsCloudEdgeV1> {
  const config = validate(value); validateCredentials(credentials)
  let requests = 0
  const server = createServer({ key: credentials.key, cert: credentials.cert, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, async (request, response) => { requests += 1; await routeCloudHttpRequestV1(handler, request, response) })
  server.requestTimeout = config.requestTimeoutMs; server.headersTimeout = config.requestTimeoutMs; server.maxConnections = config.maxConnections
  try { await listen(server, config.port, config.host) } catch (error) { server.closeAllConnections(); throw error }
  const address = server.address() as AddressInfo | null
  if (!address || address.address !== config.host || (config.port !== 0 && address.port !== config.port)) { await close(server); throw new Error('TLS cloud edge bound an unexpected address') }
  return Object.freeze({ host: config.host, port: address.port, protocol: 'TLSv1.3', requestCount: () => requests, close: () => close(server) })
}

function validate(value: unknown): TlsCloudEdgeConfigV1 {
  if (!isRecord(value)) throw new Error('TLS cloud edge config is invalid')
  const keys = ['schemaVersion', 'enabled', 'host', 'port', 'requestTimeoutMs', 'maxConnections', 'providerOwnership', 'externalEffectsEnabled']
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || value.enabled !== true || typeof value.host !== 'string' || isIP(value.host) === 0 || !Number.isSafeInteger(value.port) || (value.port as number) < 0 || (value.port as number) > 65535 || (value.port === 0 && value.host !== '127.0.0.1') || !Number.isSafeInteger(value.requestTimeoutMs) || (value.requestTimeoutMs as number) < 1_000 || (value.requestTimeoutMs as number) > 30_000 || !Number.isSafeInteger(value.maxConnections) || (value.maxConnections as number) < 1 || (value.maxConnections as number) > 10_000 || value.providerOwnership !== 'shared-host' || value.externalEffectsEnabled !== false) throw new Error('TLS cloud edge config is invalid')
  return value as unknown as TlsCloudEdgeConfigV1
}
function validateCredentials(value: { readonly key: Buffer; readonly cert: Buffer }): void { if (!value || !Buffer.isBuffer(value.key) || !Buffer.isBuffer(value.cert) || value.key.byteLength > 32_768 || value.cert.byteLength > 65_536 || !value.key.toString('ascii').includes('PRIVATE KEY-----') || !value.cert.toString('ascii').includes('CERTIFICATE-----')) throw new Error('TLS cloud edge credentials are invalid') }
function listen(server: Server, port: number, host: string): Promise<void> { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve() }) }) }
function close(server: Server): Promise<void> { return new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }) }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
