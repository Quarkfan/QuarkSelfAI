import assert from 'node:assert/strict'
import test from 'node:test'
import { DeviceProtocolFrameDecoderV1, encodeDeviceProtocolFrame, MAX_DEVICE_FRAME_BYTES, validateDeviceProtocolMessage } from '../src/client-runtime/device-codec.js'
import type { DeviceProtocolMessageV1 } from '../src/client-runtime/device-protocol.js'

const digest = `sha256:${'a'.repeat(64)}`
const hello: DeviceProtocolMessageV1 = {
  schemaVersion: 1, frameId: 'frame.001', causationId: null, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', sentAt: '2026-09-06T00:00:00.000Z',
  payload: { kind: 'client.hello', protocol: 'quark-device-sync.v1', transport: 'direct-tls', executorReportDigests: [digest] },
}

test('carries the identical device protocol over direct TLS and SSH transport labels', () => {
  const direct = encodeDeviceProtocolFrame(hello)
  const ssh = encodeDeviceProtocolFrame({ ...hello, frameId: 'frame.002', payload: { ...hello.payload as Extract<typeof hello.payload, { kind: 'client.hello' }>, transport: 'ssh-subsystem' } })
  const decoder = new DeviceProtocolFrameDecoderV1()
  const chunks = Buffer.concat([direct, ssh])
  assert.deepEqual(decoder.push(chunks.subarray(0, 7)), [])
  const decoded = decoder.push(chunks.subarray(7))
  assert.deepEqual(decoded.map(item => item.payload.kind), ['client.hello', 'client.hello'])
  assert.deepEqual(decoded.map(item => item.payload.kind === 'client.hello' ? item.payload.transport : null), ['direct-tls', 'ssh-subsystem'])
  assert.equal(decoder.bufferedBytes(), 0)
})

test('fails closed on cross-scope, unknown fields, sensitive text and oversized frames', () => {
  const challenge = {
    ...hello,
    payload: { kind: 'server.challenge', challenge: { schemaVersion: 1, challengeId: 'challenge.1', tenantId: 'other', userId: hello.userId, deviceId: hello.deviceId, nonce: 'nonce.1', issuedAt: hello.sentAt, expiresAt: '2026-09-06T00:01:00.000Z' } },
  }
  assert.throws(() => validateDeviceProtocolMessage(challenge), /scope differs/)
  assert.throws(() => validateDeviceProtocolMessage({ ...hello, payload: { kind: 'client.proof', proof: { schemaVersion: 1, challengeId: 'challenge.1', deviceId: 'device.other', keyId: 'key.1', algorithm: 'ed25519', signature: 'signature' } } }), /proof scope differs/)
  assert.throws(() => validateDeviceProtocolMessage({ ...hello, extra: true }), /unknown fields/)
  assert.throws(() => validateDeviceProtocolMessage({ ...hello, payload: { ...hello.payload, executorReportDigests: ['/Users/private'] } }), /hello payload|sensitive/)
  const decoder = new DeviceProtocolFrameDecoderV1()
  const header = Buffer.alloc(4); header.writeUInt32BE(MAX_DEVICE_FRAME_BYTES + 1)
  assert.throws(() => decoder.push(header), /length is invalid/)
})
