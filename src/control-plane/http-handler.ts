import type { InactiveCloudControlPlaneApplicationV1 } from './cloud-application.js'

export interface CloudHttpRequestV1 {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly sessionReference: string
  readonly body?: unknown
}

export interface CloudHttpResponseV1 {
  readonly status: 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422
  readonly body: Readonly<Record<string, unknown>>
}

/** A fetch-independent request handler. It never opens a listener and never parses raw cookies or bearer credentials. */
export class InactiveCloudHttpHandlerV1 {
  constructor(private readonly application: InactiveCloudControlPlaneApplicationV1) {}

  async handle(request: CloudHttpRequestV1): Promise<CloudHttpResponseV1> {
    if (!['GET', 'POST'].includes(request.method) || !request.path.startsWith('/v1/') || request.path.length > 200) return response(400, 'invalid-request')
    try {
      if (request.method === 'GET' && request.path === '/v1/devices') return response(200, 'ok', { items: await this.application.listDevices(request.sessionReference) })
      if (request.method === 'POST' && request.path === '/v1/devices') {
        const body = exactBody(request.body, ['deviceId', 'publicKey'])
        if (typeof body.deviceId !== 'string' || typeof body.publicKey !== 'string') return response(400, 'invalid-body')
        return response(201, 'created', { item: await this.application.registerDevice(request.sessionReference, { deviceId: body.deviceId, publicKey: body.publicKey }) })
      }
      if (request.method === 'GET' && request.path === '/v1/capabilities') return response(200, 'ok', { items: await this.application.listCapabilities(request.sessionReference) })
      if (request.method === 'GET' && request.path === '/v1/agent-drafts') return response(200, 'ok', { items: await this.application.listAgentDrafts(request.sessionReference) })
      return response(404, 'not-found')
    } catch (error) {
      const message = String(error)
      if (/not authenticated|session reference/.test(message)) return response(401, 'unauthenticated')
      if (/not authorized/.test(message)) return response(403, 'forbidden')
      if (/conflict|immutable|concurrently/.test(message)) return response(409, 'conflict')
      if (/body/.test(message)) return response(400, 'invalid-body')
      return response(422, 'rejected')
    }
  }
}

function exactBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be an object')
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !(key in body))) throw new Error('request body fields are invalid')
  return body
}
function response(status: CloudHttpResponseV1['status'], code: string, value: Record<string, unknown> = {}): CloudHttpResponseV1 { return Object.freeze({ status, body: Object.freeze({ code, ...value }) }) }
