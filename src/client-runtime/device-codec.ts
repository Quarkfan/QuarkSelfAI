import type { DeviceProtocolMessageV1, DeviceProtocolPayloadV1 } from './device-protocol.js'

export const MAX_DEVICE_FRAME_BYTES = 256 * 1024
const id = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const digest = /^sha256:[a-f0-9]{64}$/
const absolutePath = /^(?:\/|[A-Za-z]:[\\/]|~(?:[\\/]|$))/
const secretAssignment = /(?:token|secret|password|private[_-]?key)\s*[:=]/i
const payloadKinds = new Set(['client.hello', 'server.challenge', 'client.proof', 'server.session', 'client.poll', 'server.lease', 'client.ack', 'client.result', 'client.heartbeat'])

export function validateDeviceProtocolMessage(value: unknown): DeviceProtocolMessageV1 {
  if (!record(value)) throw new Error('device protocol message must be an object')
  exactKeys(value, ['schemaVersion', 'frameId', 'causationId', 'tenantId', 'userId', 'deviceId', 'sentAt', 'payload'], 'device message')
  if (value.schemaVersion !== 1) throw new Error('device protocol schema is unsupported')
  for (const key of ['frameId', 'tenantId', 'userId', 'deviceId'] as const) if (typeof value[key] !== 'string' || !id.test(value[key])) throw new Error(`device message ${key} is invalid`)
  if (value.causationId !== null && (typeof value.causationId !== 'string' || !id.test(value.causationId))) throw new Error('device message causationId is invalid')
  if (typeof value.sentAt !== 'string' || Number.isNaN(Date.parse(value.sentAt))) throw new Error('device message sentAt is invalid')
  if (!record(value.payload) || typeof value.payload.kind !== 'string' || !payloadKinds.has(value.payload.kind)) throw new Error('device message payload kind is invalid')
  validatePayload(value.payload as unknown as DeviceProtocolPayloadV1, value)
  rejectSensitiveStrings(value)
  return deepFreeze(structuredClone(value)) as unknown as DeviceProtocolMessageV1
}

export function encodeDeviceProtocolFrame(value: DeviceProtocolMessageV1): Buffer {
  const body = Buffer.from(JSON.stringify(validateDeviceProtocolMessage(value)), 'utf8')
  if (body.byteLength > MAX_DEVICE_FRAME_BYTES) throw new Error('device protocol frame exceeds limit')
  const frame = Buffer.allocUnsafe(4 + body.byteLength)
  frame.writeUInt32BE(body.byteLength, 0)
  body.copy(frame, 4)
  return frame
}

export class DeviceProtocolFrameDecoderV1 {
  #buffer = Buffer.alloc(0)

  push(chunk: Buffer): readonly DeviceProtocolMessageV1[] {
    if (!chunk.byteLength) return []
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    const messages: DeviceProtocolMessageV1[] = []
    while (this.#buffer.byteLength >= 4) {
      const length = this.#buffer.readUInt32BE(0)
      if (length <= 0 || length > MAX_DEVICE_FRAME_BYTES) throw new Error('device protocol frame length is invalid')
      if (this.#buffer.byteLength < length + 4) break
      const body = this.#buffer.subarray(4, length + 4)
      this.#buffer = this.#buffer.subarray(length + 4)
      let value: unknown
      try { value = JSON.parse(body.toString('utf8')) } catch { throw new Error('device protocol frame is not valid JSON') }
      messages.push(validateDeviceProtocolMessage(value))
    }
    if (this.#buffer.byteLength > MAX_DEVICE_FRAME_BYTES + 4) throw new Error('device protocol buffered data exceeds limit')
    return Object.freeze(messages)
  }

  bufferedBytes(): number { return this.#buffer.byteLength }
}

function validatePayload(payload: DeviceProtocolPayloadV1, message: Record<string, unknown>): void {
  if (payload.kind === 'client.hello') {
    exactKeys(payload, ['kind', 'protocol', 'transport', 'executorReportDigests'], payload.kind)
    if (payload.protocol !== 'quark-device-sync.v1' || !['direct-tls', 'ssh-subsystem'].includes(payload.transport) || !Array.isArray(payload.executorReportDigests) || payload.executorReportDigests.some(item => typeof item !== 'string' || !digest.test(item))) throw new Error('device hello payload is invalid')
    return
  }
  const scoped = payload.kind === 'server.challenge' ? payload.challenge
    : payload.kind === 'server.session' ? payload.session
      : payload.kind === 'server.lease' ? payload.lease?.plan.envelope
        : payload.kind === 'client.result' ? payload.result
          : undefined
  if (scoped && (scoped.tenantId !== message.tenantId || ('userId' in scoped && scoped.userId !== message.userId) || ('deviceId' in scoped && scoped.deviceId !== message.deviceId))) throw new Error('device payload scope differs from message scope')
  if (payload.kind === 'client.proof' && payload.proof.deviceId !== message.deviceId) throw new Error('device proof scope differs from message scope')
  if (payload.kind === 'client.ack' && payload.acknowledgement.deviceId !== message.deviceId) throw new Error('device acknowledgement scope differs from message scope')
  if (payload.kind === 'server.lease' && payload.lease && (payload.lease.deviceId !== message.deviceId || payload.lease.planId !== payload.lease.plan.planId)) throw new Error('device lease scope differs from message scope')
  if (payload.kind === 'client.poll' || payload.kind === 'client.heartbeat') exactKeys(payload, ['kind', 'sessionId'], payload.kind)
  if (payload.kind === 'server.challenge') exactKeys(payload, ['kind', 'challenge'], payload.kind)
  if (payload.kind === 'client.proof') exactKeys(payload, ['kind', 'proof'], payload.kind)
  if (payload.kind === 'server.session') exactKeys(payload, ['kind', 'session'], payload.kind)
  if (payload.kind === 'server.lease') exactKeys(payload, ['kind', 'lease'], payload.kind)
  if (payload.kind === 'client.ack') exactKeys(payload, ['kind', 'acknowledgement'], payload.kind)
  if (payload.kind === 'client.result') exactKeys(payload, ['kind', 'result'], payload.kind)
}

function rejectSensitiveStrings(value: unknown): void {
  if (typeof value === 'string' && (absolutePath.test(value) || secretAssignment.test(value))) throw new Error('device protocol message contains forbidden sensitive text')
  if (Array.isArray(value)) value.forEach(rejectSensitiveStrings)
  else if (record(value)) Object.values(value).forEach(rejectSensitiveStrings)
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  const extras = Object.keys(value).filter(key => !keys.includes(key))
  if (extras.length) throw new Error(`${label} has unknown fields: ${extras.join(',')}`)
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }
