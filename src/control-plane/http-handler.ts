import type { InactiveCloudControlPlaneApplicationV1 } from './cloud-application.js'

export interface CloudHttpRequestV1 {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly sessionReference?: string
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
      if (request.method === 'GET' && request.path === '/v1/devices') return response(200, 'ok', { items: await this.application.listDevices(requiredSession(request)) })
      if (request.method === 'POST' && request.path === '/v1/device-enrollments') {
        const body = exactBody(request.body, ['tenantId', 'userId', 'deviceId', 'publicKey'])
        if (['tenantId', 'userId', 'deviceId', 'publicKey'].some(key => typeof body[key] !== 'string')) return response(400, 'invalid-body')
        return response(201, 'created', { item: await this.application.beginDeviceEnrollment(body as { tenantId: string; userId: string; deviceId: string; publicKey: string }) })
      }
      if (request.method === 'POST' && request.path === '/v1/device-enrollments/approve') {
        const body = exactBody(request.body, ['userCode']); if (typeof body.userCode !== 'string') return response(400, 'invalid-body')
        return response(200, 'ok', { item: await this.application.approveDeviceEnrollment(requiredSession(request), body.userCode) })
      }
      if (request.method === 'POST' && request.path === '/v1/device-enrollments/poll') {
        const body = exactBody(request.body, ['requestId', 'pollToken']); if (typeof body.requestId !== 'string' || typeof body.pollToken !== 'string') return response(400, 'invalid-body')
        return response(200, 'ok', { item: await this.application.pollDeviceEnrollment({ requestId: body.requestId, pollToken: body.pollToken }) })
      }
      if (request.method === 'POST' && request.path === '/v1/devices') {
        const body = exactBody(request.body, ['deviceId', 'publicKey'])
        if (typeof body.deviceId !== 'string' || typeof body.publicKey !== 'string') return response(400, 'invalid-body')
        return response(201, 'created', { item: await this.application.registerDevice(requiredSession(request), { deviceId: body.deviceId, publicKey: body.publicKey }) })
      }
      if (request.method === 'POST' && request.path === '/v1/device-sessions/challenge') { const body = exactBody(request.body, ['deviceId']); if (typeof body.deviceId !== 'string') return response(400, 'invalid-body'); return response(201, 'created', { item: await this.application.issueDeviceChallenge(requiredSession(request), body.deviceId) }) }
      if (request.method === 'POST' && request.path === '/v1/device-connect/challenge') { const body = exactBody(request.body, ['tenantId', 'userId', 'deviceId']); if (['tenantId', 'userId', 'deviceId'].some(key => typeof body[key] !== 'string')) return response(400, 'invalid-body'); return response(201, 'created', { item: await this.application.issueDeviceReconnectChallenge(body as { tenantId: string; userId: string; deviceId: string }) }) }
      if (request.method === 'POST' && request.path === '/v1/device-sessions/proof') { const body = exactBody(request.body, ['proof']); return response(201, 'created', { item: await this.application.openDeviceSession(deviceProof(body.proof)) }) }
      if (request.method === 'POST' && request.path === '/v1/device-sessions/poll') { const body = exactBody(request.body, ['sessionId']); if (typeof body.sessionId !== 'string') return response(400, 'invalid-body'); return response(200, 'ok', { item: await this.application.pollDeviceSession(body.sessionId) }) }
      if (request.method === 'POST' && request.path === '/v1/device-sessions/ack') { const body = exactBody(request.body, ['sessionId', 'leaseToken', 'taskId']); if (typeof body.sessionId !== 'string' || typeof body.leaseToken !== 'string' || typeof body.taskId !== 'string') return response(400, 'invalid-body'); return response(200, 'ok', { item: await this.application.acknowledgeDeviceLease(body.sessionId, { leaseToken: body.leaseToken, taskId: body.taskId }) }) }
      if (request.method === 'POST' && request.path === '/v1/device-sessions/result') { const body = exactBody(request.body, ['sessionId', 'result']); if (typeof body.sessionId !== 'string') return response(400, 'invalid-body'); return response(200, 'ok', { item: await this.application.submitDeviceResult(body.sessionId, redactedResult(body.result)) }) }
      if (request.method === 'GET' && request.path === '/v1/capabilities') return response(200, 'ok', { items: await this.application.listCapabilities(requiredSession(request)) })
      if (request.method === 'POST' && request.path === '/v1/capabilities') {
        const body = exactBody(request.body, ['candidate', 'evidence', 'visibility'])
        if (!body.candidate || typeof body.candidate !== 'object' || Array.isArray(body.candidate) || !body.evidence || typeof body.evidence !== 'object' || Array.isArray(body.evidence) || !['private', 'tenant'].includes(String(body.visibility))) return response(400, 'invalid-body')
        return response(201, 'created', { item: await this.application.registerCapability(requiredSession(request), { candidate: body.candidate as never, evidence: body.evidence as never, visibility: body.visibility as 'private' | 'tenant' }) })
      }
      if (request.method === 'GET' && request.path === '/v1/agent-drafts') return response(200, 'ok', { items: await this.application.listAgentDrafts(requiredSession(request)) })
      if (request.method === 'POST' && request.path === '/v1/agent-drafts') {
        const body = exactBody(request.body, ['draftId', 'blueprint', 'expectedRevision'])
        if (typeof body.draftId !== 'string' || !Number.isSafeInteger(body.expectedRevision) || !body.blueprint || typeof body.blueprint !== 'object' || Array.isArray(body.blueprint)) return response(400, 'invalid-body')
        return response(201, 'created', { item: await this.application.saveAgentDraft(requiredSession(request), { draftId: body.draftId, blueprint: body.blueprint as never, expectedRevision: Number(body.expectedRevision) }) })
      }
      if (request.method === 'POST' && request.path === '/v1/agent-drafts/publish-test') {
        const body = exactBody(request.body, ['draftId', 'expectedRevision'])
        if (typeof body.draftId !== 'string' || !Number.isSafeInteger(body.expectedRevision)) return response(400, 'invalid-body')
        return response(201, 'created', { item: await this.application.publishAgentTest(requiredSession(request), { draftId: body.draftId, expectedRevision: Number(body.expectedRevision) }) })
      }
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

function requiredSession(request: CloudHttpRequestV1): string { if (typeof request.sessionReference !== 'string') throw new Error('cloud session reference is invalid'); return request.sessionReference }

function exactBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be an object')
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !(key in body))) throw new Error('request body fields are invalid')
  return body
}
function deviceProof(value: unknown) {
  const proof = exactBody(value, ['schemaVersion', 'challengeId', 'deviceId', 'keyId', 'algorithm', 'signature'])
  if (proof.schemaVersion !== 1 || proof.algorithm !== 'ed25519' || ['challengeId', 'deviceId', 'keyId', 'signature'].some(key => typeof proof[key] !== 'string' || !(proof[key] as string).trim())) throw new Error('request body device proof is invalid')
  return proof as unknown as { schemaVersion: 1; challengeId: string; deviceId: string; keyId: string; algorithm: 'ed25519'; signature: string }
}
function redactedResult(value: unknown) {
  const result = exactBody(value, ['deviceId', 'taskId', 'planId', 'outcome', 'summaryCode', 'artifactDigests', 'completedAt'])
  if (['deviceId', 'taskId', 'planId', 'summaryCode', 'completedAt'].some(key => typeof result[key] !== 'string' || !(result[key] as string).trim()) ||
      !['succeeded', 'failed', 'cancelled'].includes(String(result.outcome)) || !Array.isArray(result.artifactDigests) || result.artifactDigests.some(value => typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) ||
      Number.isNaN(Date.parse(String(result.completedAt))) || /^(?:\/|[A-Za-z]:[\\/]|~[\\/])|(?:token|secret|password|private[_-]?key)\s*[:=]/i.test(String(result.summaryCode))) throw new Error('request body result is invalid')
  return result as unknown as { deviceId: string; taskId: string; planId: string; outcome: 'succeeded' | 'failed' | 'cancelled'; summaryCode: string; artifactDigests: readonly string[]; completedAt: string }
}
function response(status: CloudHttpResponseV1['status'], code: string, value: Record<string, unknown> = {}): CloudHttpResponseV1 { return Object.freeze({ status, body: Object.freeze({ code, ...value }) }) }
