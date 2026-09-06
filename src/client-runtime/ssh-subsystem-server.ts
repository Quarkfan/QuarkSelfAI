import { randomBytes } from 'node:crypto'
import type { DeviceSessionServerPortV1 } from '../control-plane/contracts.js'
import { DeviceProtocolFrameDecoderV1, encodeDeviceProtocolFrame, MAX_DEVICE_FRAME_BYTES, validateDeviceProtocolMessage } from './device-codec.js'
import type { DeviceProtocolMessageV1, DeviceProtocolPayloadV1 } from './device-protocol.js'

const clientKinds = new Set(['client.hello', 'client.proof', 'client.poll', 'client.ack-request', 'client.result-submit'])

/** Handles exactly one framed subsystem request against the canonical device-session provider. */
export async function handleSshSubsystemRequestV1(server: DeviceSessionServerPortV1, input: unknown, now = new Date()): Promise<DeviceProtocolMessageV1> {
  const request = validateDeviceProtocolMessage(input)
  if (!clientKinds.has(request.payload.kind) || request.causationId !== null || Number.isNaN(now.getTime())) throw new Error('SSH subsystem request is invalid')
  let payload: DeviceProtocolPayloadV1
  try {
    if (request.payload.kind === 'client.hello') payload = { kind: 'server.challenge', challenge: await server.issueChallenge(scope(request), now) }
    else if (request.payload.kind === 'client.proof') payload = { kind: 'server.session', session: await server.openSession(request.payload.proof, now) }
    else if (request.payload.kind === 'client.poll') payload = { kind: 'server.lease', lease: await server.poll(request.payload.sessionId, now) }
    else if (request.payload.kind === 'client.ack-request') payload = { kind: 'server.ack', acknowledgement: await server.acknowledge(request.payload.sessionId, { leaseToken: request.payload.leaseToken, taskId: request.payload.taskId }, now) }
    else if (request.payload.kind === 'client.result-submit') payload = { kind: 'server.result', result: await server.submitResult(request.payload.sessionId, request.payload.result, now) }
    else throw new Error('SSH subsystem request is invalid')
  } catch {
    payload = { kind: 'server.error', code: 'request-rejected' }
  }
  return validateDeviceProtocolMessage({ schemaVersion: 1, frameId: `frame.s.${randomBytes(12).toString('hex')}`, causationId: request.frameId,
    tenantId: request.tenantId, userId: request.userId, deviceId: request.deviceId, sentAt: now.toISOString(), payload })
}

function scope(request: DeviceProtocolMessageV1): { tenantId: string; userId: string; deviceId: string } {
  return { tenantId: request.tenantId, userId: request.userId, deviceId: request.deviceId }
}

/** Decodes one request and emits one response; an sshd subsystem entry can bind these bytes to stdin/stdout without another protocol. */
export async function handleSshSubsystemFrameV1(server: DeviceSessionServerPortV1, input: Buffer, now = new Date()): Promise<Buffer> {
  const decoder = new DeviceProtocolFrameDecoderV1(); const messages = decoder.push(input)
  if (messages.length !== 1 || decoder.bufferedBytes() !== 0) throw new Error('SSH subsystem requires exactly one complete request frame')
  return encodeDeviceProtocolFrame(await handleSshSubsystemRequestV1(server, messages[0], now))
}

/** Bounded stdin/stdout binding for an sshd ForceCommand/subsystem wrapper. It serves one request and then returns. */
export async function serveSshSubsystemStdioOnceV1(server: DeviceSessionServerPortV1, input: AsyncIterable<Buffer | string>, write: (response: Buffer) => void | Promise<void>, now = new Date()): Promise<void> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk); size += bytes.byteLength
    if (size > MAX_DEVICE_FRAME_BYTES + 4) throw new Error('SSH subsystem request is too large')
    chunks.push(bytes)
  }
  if (!size) throw new Error('SSH subsystem request is required')
  await write(await handleSshSubsystemFrameV1(server, Buffer.concat(chunks), now))
}
