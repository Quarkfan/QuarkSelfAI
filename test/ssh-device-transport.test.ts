import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { DeviceSessionServerPortV1, RedactedResultV1 } from '../src/control-plane/contracts.js'
import { DeviceProtocolFrameDecoderV1, encodeDeviceProtocolFrame } from '../src/client-runtime/device-codec.js'
import { NodeInactiveSshDeviceTransportV1, type SshSubsystemUnaryRunnerV1 } from '../src/client-runtime/ssh-device-transport.js'
import { handleSshSubsystemFrameV1, handleSshSubsystemRequestV1, serveSshSubsystemStdioOnceV1 } from '../src/client-runtime/ssh-subsystem-server.js'
import { prepareInactiveSshSubsystemLaunch } from '../src/client-runtime/ssh-subsystem-process.js'
import type { DeviceTransportPolicyV1 } from '../src/client-runtime/device-transport.js'

const now = new Date('2026-09-06T00:00:00.000Z')
const scope = { tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner' }
const session = { schemaVersion: 1 as const, sessionId: 'session.device.1', ...scope, issuedAt: now.toISOString(), expiresAt: '2026-09-06T01:00:00.000Z', state: 'active' as const }
const challenge = { schemaVersion: 1 as const, challengeId: 'challenge.1', ...scope, nonce: 'nonce.1', issuedAt: now.toISOString(), expiresAt: '2026-09-06T00:01:00.000Z' }
const proof = { schemaVersion: 1 as const, challengeId: challenge.challengeId, deviceId: scope.deviceId, keyId: 'key.device', algorithm: 'ed25519' as const, signature: 'signature' }
const resultInput = { deviceId: scope.deviceId, taskId: 'task.1', planId: 'plan.1', outcome: 'succeeded' as const, summaryCode: 'completed', artifactDigests: [] as string[], completedAt: now.toISOString() }

async function launch() {
  const policy = JSON.parse(await readFile(new URL('../config/device-transport-policy.json', import.meta.url), 'utf8')) as DeviceTransportPolicyV1
  return prepareInactiveSshSubsystemLaunch(policy, { endpointRef: 'endpoint:ssh-gateway', host: 'gateway.example.com', port: 22, userRef: 'identity:device-tunnel', user: 'quark_device', credentialRef: 'secret:ssh-device-key', identityFile: '/private/client/key', hostKeyFingerprintRef: 'identity:ssh-host-key', knownHostsFile: '/private/client/known-hosts' })
}

test('carries the complete canonical device-session port through one fixed SSH subsystem', async () => {
  const calls: string[] = []; const frames: string[] = []
  const provider: DeviceSessionServerPortV1 = {
    async issueChallenge(input) { assert.deepEqual(input, scope); calls.push('challenge'); return challenge },
    async openSession(input) { assert.deepEqual(input, proof); calls.push('session'); return session },
    async poll(id) { assert.equal(id, session.sessionId); calls.push('poll'); return null },
    async acknowledge(id, input) { assert.equal(id, session.sessionId); assert.deepEqual(input, { leaseToken: 'lease.1', taskId: 'task.1' }); calls.push('ack'); return { schemaVersion: 1, taskId: 'task.1', planId: 'plan.1', deviceId: scope.deviceId, state: 'accepted', acceptedAt: now.toISOString() } },
    async submitResult(id, input) { assert.equal(id, session.sessionId); assert.deepEqual(input, resultInput); calls.push('result'); return { tenantId: scope.tenantId, userId: scope.userId, ...input } },
  }
  const runner: SshSubsystemUnaryRunnerV1 = { async run(spec, request) {
    assert.deepEqual(spec.args.slice(-2), ['quark_device@gateway.example.com', 'quark-device-v1'])
    const decoder = new DeviceProtocolFrameDecoderV1(); const items = decoder.push(request); assert.equal(items.length, 1); frames.push(items[0]!.payload.kind)
    return await handleSshSubsystemFrameV1(provider, request, now)
  } }
  const transport = new NodeInactiveSshDeviceTransportV1(scope, await launch(), 5_000, runner)
  assert.deepEqual(await transport.issueChallenge(scope), challenge)
  assert.deepEqual(await transport.openSession(proof), session)
  assert.equal(await transport.poll(session.sessionId), null)
  assert.equal((await transport.acknowledge(session.sessionId, { leaseToken: 'lease.1', taskId: 'task.1' })).state, 'accepted')
  assert.deepEqual(await transport.submitResult(session.sessionId, resultInput), { tenantId: scope.tenantId, userId: scope.userId, ...resultInput } satisfies RedactedResultV1)
  assert.deepEqual(calls, ['challenge', 'session', 'poll', 'ack', 'result'])
  assert.deepEqual(frames, ['client.hello', 'client.proof', 'client.poll', 'client.ack-request', 'client.result-submit'])
})

test('fails closed on scope drift and returns no provider error detail', async () => {
  const provider = { async poll() { throw new Error('secret tenant detail') } } as unknown as DeviceSessionServerPortV1
  const runner: SshSubsystemUnaryRunnerV1 = { async run(_spec, request) { const decoder = new DeviceProtocolFrameDecoderV1(); return encodeDeviceProtocolFrame(await handleSshSubsystemRequestV1(provider, decoder.push(request)[0], now)) } }
  const transport = new NodeInactiveSshDeviceTransportV1(scope, await launch(), 5_000, runner)
  await assert.rejects(() => transport.issueChallenge({ ...scope, tenantId: 'test.beta' }), /out of scope/)
  await assert.rejects(() => transport.poll('session.unknown'), error => { assert.equal(String(error).includes('secret tenant detail'), false); return /request was rejected/.test(String(error)) })
})

test('binds exactly one bounded request to subsystem stdin and stdout', async () => {
  const provider = { async poll(id: string) { assert.equal(id, session.sessionId); return null } } as unknown as DeviceSessionServerPortV1
  const request = encodeDeviceProtocolFrame({ schemaVersion: 1, frameId: 'frame.c.stdin', causationId: null, ...scope, sentAt: now.toISOString(), payload: { kind: 'client.poll', sessionId: session.sessionId } })
  let response: Buffer | undefined
  await serveSshSubsystemStdioOnceV1(provider, (async function * () { yield request.subarray(0, 3); yield request.subarray(3) })(), bytes => { response = bytes }, now)
  const decoder = new DeviceProtocolFrameDecoderV1(); const items = decoder.push(response!)
  assert.equal(items.length, 1); assert.equal(items[0]!.causationId, 'frame.c.stdin'); assert.equal(items[0]!.payload.kind, 'server.lease')
  await assert.rejects(() => serveSshSubsystemStdioOnceV1(provider, (async function * () {})(), () => undefined, now), /required/)
})
