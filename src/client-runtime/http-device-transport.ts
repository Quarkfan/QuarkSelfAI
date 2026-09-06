import type { DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseAcknowledgementV1, DeviceTaskLeaseV1 } from './contracts.js'
import type { DeviceSessionServerPortV1, RedactedResultV1 } from '../control-plane/contracts.js'

const maxResponseBytes = 256 * 1024
const idPattern = /^[a-z0-9][a-z0-9._:-]{0,255}$/

/** Outbound-only device client. HTTPS is mandatory except for an explicit ephemeral IPv4-loopback test edge. */
export class NodeInactiveHttpDeviceTransportV1 implements DeviceSessionServerPortV1 {
  readonly #base: URL
  constructor(endpoint: string, private readonly timeoutMs = 5_000) {
    const value = new URL(endpoint)
    const loopback = value.protocol === 'http:' && value.hostname === '127.0.0.1' && Boolean(value.port)
    if ((!loopback && value.protocol !== 'https:') || value.username || value.password || value.search || value.hash || value.pathname !== '/' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('device transport endpoint must be HTTPS or explicit ephemeral IPv4 loopback')
    this.#base = value
  }

  async issueChallenge(input: { readonly tenantId: string; readonly userId: string; readonly deviceId: string }): Promise<DeviceSessionChallengeV1> {
    const item = object(await this.#post('/v1/device-connect/challenge', input), 'challenge')
    if (item.schemaVersion !== 1 || !ids(item, ['challengeId', 'tenantId', 'userId', 'deviceId', 'nonce']) || item.tenantId !== input.tenantId || item.userId !== input.userId || item.deviceId !== input.deviceId || !times(item, ['issuedAt', 'expiresAt'])) throw new Error('device transport returned an invalid challenge')
    return item as unknown as DeviceSessionChallengeV1
  }

  async openSession(proof: DeviceSessionProofV1): Promise<DeviceSessionV1> {
    const item = object(await this.#post('/v1/device-sessions/proof', { proof }), 'session')
    if (item.schemaVersion !== 1 || !ids(item, ['sessionId', 'tenantId', 'userId', 'deviceId']) || !times(item, ['issuedAt', 'expiresAt']) || !['active', 'superseded', 'expired', 'revoked'].includes(String(item.state))) throw new Error('device transport returned an invalid session')
    return item as unknown as DeviceSessionV1
  }

  async poll(sessionId: string): Promise<DeviceTaskLeaseV1 | null> {
    const item = await this.#post('/v1/device-sessions/poll', { sessionId })
    if (item === null) return null
    const lease = object(item, 'lease')
    if (lease.schemaVersion !== 1 || !ids(lease, ['taskId', 'planId', 'deviceId', 'leaseToken']) || !Number.isSafeInteger(lease.attempt) || Number(lease.attempt) < 1 || lease.externalWritesEnabled !== false || !times(lease, ['leasedAt', 'expiresAt']) || !lease.plan || typeof lease.plan !== 'object') throw new Error('device transport returned an invalid lease')
    return lease as unknown as DeviceTaskLeaseV1
  }

  async acknowledge(sessionId: string, input: { readonly leaseToken: string; readonly taskId: string }): Promise<DeviceTaskLeaseAcknowledgementV1> {
    const item = object(await this.#post('/v1/device-sessions/ack', { sessionId, ...input }), 'acknowledgement')
    if (item.schemaVersion !== 1 || !ids(item, ['taskId', 'planId', 'deviceId']) || item.state !== 'accepted' || !times(item, ['acceptedAt'])) throw new Error('device transport returned an invalid acknowledgement')
    return item as unknown as DeviceTaskLeaseAcknowledgementV1
  }

  async submitResult(sessionId: string, input: Omit<RedactedResultV1, 'tenantId' | 'userId'>): Promise<RedactedResultV1> {
    const item = object(await this.#post('/v1/device-sessions/result', { sessionId, result: input }), 'result')
    if (!ids(item, ['tenantId', 'userId', 'deviceId', 'taskId', 'planId', 'summaryCode']) || !['succeeded', 'failed', 'cancelled'].includes(String(item.outcome)) || !times(item, ['completedAt']) || !Array.isArray(item.artifactDigests)) throw new Error('device transport returned an invalid result')
    return item as unknown as RedactedResultV1
  }

  async #post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.#base), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs), headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const length = Number(response.headers.get('content-length') ?? '0')
    if (length > maxResponseBytes) throw new Error('device transport response is too large')
    const text = await response.text()
    if (Buffer.byteLength(text) > maxResponseBytes) throw new Error('device transport response is too large')
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new Error('device transport response is not JSON') }
    const envelope = object(value, 'response')
    if (!response.ok || (envelope.code !== 'ok' && envelope.code !== 'created')) throw new Error(`device transport rejected request with ${typeof envelope.code === 'string' ? envelope.code : 'unknown'}`)
    return envelope.item
  }
}

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`device transport ${label} is invalid`); return value as Record<string, unknown> }
function ids(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every(key => typeof value[key] === 'string' && idPattern.test(String(value[key]))) }
function times(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every(key => typeof value[key] === 'string' && !Number.isNaN(Date.parse(String(value[key])))) }
