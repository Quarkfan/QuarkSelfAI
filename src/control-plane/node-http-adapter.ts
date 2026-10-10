import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CloudHttpRequestHandlerV1, CloudHttpResponseV1 } from './http-handler.js'

const maxBodyBytes = 64 * 1024
const sessionHeader = 'x-quark-session'

export interface EphemeralCloudEdgeV1 {
  readonly host: '127.0.0.1'
  readonly port: number
  requestCount(): number
  close(): Promise<void>
}

/** Test-only Node edge. It cannot bind a public interface or a fixed port. */
export async function openEphemeralLoopbackCloudEdge(handler: CloudHttpRequestHandlerV1): Promise<EphemeralCloudEdgeV1> {
  let requests = 0
  const server = createServer(async (request, response) => {
    requests += 1
    await routeCloudHttpRequestV1(handler, request, response)
  })
  server.requestTimeout = 5_000
  server.headersTimeout = 5_000
  await listen(server)
  const address = server.address() as AddressInfo | null
  if (!address || address.address !== '127.0.0.1' || address.port <= 0) {
    await close(server)
    throw new Error('cloud edge did not bind an ephemeral IPv4 loopback address')
  }
  return Object.freeze({ host: '127.0.0.1', port: address.port, requestCount: () => requests, close: () => close(server) })
}

export async function routeCloudHttpRequestV1(handler: CloudHttpRequestHandlerV1, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if ((request.method !== 'GET' && request.method !== 'POST') || !request.url || request.url.includes('?')) return send(response, { status: 400, body: { code: 'invalid-request' } })
    const sessionValue = request.headers[sessionHeader]
    if (Array.isArray(sessionValue) || (sessionValue !== undefined && (sessionValue.length > 160 || !/^session:[a-z0-9][a-z0-9._:-]{0,127}$/.test(sessionValue)))) return send(response, { status: 401, body: { code: 'unauthenticated' } })
    let body: unknown
    if (request.method === 'POST') {
      if (request.headers['content-type'] !== 'application/json') return send(response, { status: 400, body: { code: 'invalid-body' } })
      body = JSON.parse(await readBoundedBody(request))
    }
    const result = await handler.handle({ method: request.method, path: request.url, ...(sessionValue ? { sessionReference: sessionValue } : {}), ...(request.method === 'POST' ? { body } : {}) })
    send(response, result)
  } catch {
    send(response, { status: 400, body: { code: 'invalid-request' } })
  }
}

function send(response: ServerResponse, result: CloudHttpResponseV1): void {
  const isAsset = typeof result.body === 'string'
  response.writeHead(result.status, {
    'content-type': isAsset ? result.contentType ?? 'text/plain; charset=utf-8' : 'application/json',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  }).end(isAsset ? result.body : JSON.stringify(result.body))
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
}

function close(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

async function readBoundedBody(request: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBodyBytes) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (!size) throw new Error('request body is required')
  return Buffer.concat(chunks).toString('utf8')
}
