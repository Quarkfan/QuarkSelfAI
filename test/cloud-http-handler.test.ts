import assert from 'node:assert/strict'
import test from 'node:test'
import { InactiveCloudControlPlaneApplicationV1 } from '../src/control-plane/cloud-application.js'
import { InactiveCloudHttpHandlerV1 } from '../src/control-plane/http-handler.js'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'

const context: TenantContextV1 = { tenantId: 'test.alpha', userId: 'owner', roles: ['owner'] }

function handler() {
  const calls: string[] = []
  const identity = { async resolveSession(reference: string) { return reference === 'session:valid' ? context : undefined } }
  const capabilities = { async listVisible() { calls.push('capabilities.list'); return [] }, async registerInactive() { throw new Error('unused') }, async get() { return undefined }, async close() {} }
  const studio = { async listDrafts() { calls.push('drafts.list'); return [] }, async saveDraft() { throw new Error('unused') }, async publishTest() { throw new Error('unused') }, async getDraft() { return undefined }, async close() {} }
  const devices = {
    async listDevices() { calls.push('devices.list'); return [] },
    async registerDevice(resolved: TenantContextV1, input: { deviceId: string; publicKey: string }) { calls.push(`devices.register:${resolved.tenantId}:${input.deviceId}`); return { tenantId: resolved.tenantId, userId: resolved.userId, deviceId: input.deviceId, publicKey: input.publicKey, state: 'registered' as const, createdAt: '2026-09-06T00:00:00.000Z' } },
  }
  const sessions = {
    async issueChallenge(resolved: TenantContextV1, deviceId: string) { calls.push(`challenge:${resolved.tenantId}:${deviceId}`); return { challengeId: 'challenge.one' } as never },
    async openSession(proof: { deviceId: string }) { calls.push(`proof:${proof.deviceId}`); return { sessionId: 'session.device' } as never },
    async poll(sessionId: string) { calls.push(`poll:${sessionId}`); return null },
    async acknowledge(sessionId: string, input: { taskId: string }) { calls.push(`ack:${sessionId}:${input.taskId}`); return { state: 'accepted' } as never },
    async submitResult(sessionId: string, input: { taskId: string }) { calls.push(`result:${sessionId}:${input.taskId}`); return { tenantId: 'test.alpha', userId: 'owner', ...input } as never },
  }
  const application = new InactiveCloudControlPlaneApplicationV1(identity, capabilities, studio, devices, sessions)
  return { handler: new InactiveCloudHttpHandlerV1(application), calls }
}

test('routes authenticated device and catalog requests without accepting tenant input', async () => {
  const fixture = handler()
  const created = await fixture.handler.handle({ method: 'POST', path: '/v1/devices', sessionReference: 'session:valid', body: { deviceId: 'device.one', publicKey: 'public-key' } })
  assert.equal(created.status, 201)
  assert.deepEqual(fixture.calls, ['devices.register:test.alpha:device.one'])
  assert.equal((created.body.item as { tenantId: string }).tenantId, 'test.alpha')
  assert.equal((await fixture.handler.handle({ method: 'GET', path: '/v1/capabilities', sessionReference: 'session:valid' })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'GET', path: '/v1/agent-drafts', sessionReference: 'session:valid' })).status, 200)
})

test('returns bounded errors and rejects tenant injection before a provider call', async () => {
  const fixture = handler()
  const injected = await fixture.handler.handle({ method: 'POST', path: '/v1/devices', sessionReference: 'session:valid', body: { tenantId: 'test.beta', deviceId: 'device.one', publicKey: 'public-key' } })
  assert.deepEqual(injected, { status: 400, body: { code: 'invalid-body' } })
  assert.equal((await fixture.handler.handle({ method: 'GET', path: '/v1/devices', sessionReference: 'session:missing' })).status, 401)
  assert.equal((await fixture.handler.handle({ method: 'GET', path: '/v1/unknown', sessionReference: 'session:valid' })).status, 404)
  assert.deepEqual(fixture.calls, [])
})

test('routes device challenge, proof, poll, acknowledgement and result through one session provider', async () => {
  const fixture = handler()
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/challenge', sessionReference: 'session:valid', body: { deviceId: 'device.one' } })).status, 201)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/proof', body: { proof: { schemaVersion: 1, challengeId: 'challenge.one', deviceId: 'device.one', keyId: 'key.one', algorithm: 'ed25519', signature: 'signature' } } })).status, 201)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/poll', body: { sessionId: 'session.device' } })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/ack', body: { sessionId: 'session.device', leaseToken: 'lease.one', taskId: 'task.one' } })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/result', body: { sessionId: 'session.device', result: { deviceId: 'device.one', taskId: 'task.one', planId: 'plan.one', outcome: 'succeeded', summaryCode: 'ok', artifactDigests: [], completedAt: '2026-09-06T00:00:00.000Z' } } })).status, 200)
  assert.deepEqual(fixture.calls, ['challenge:test.alpha:device.one', 'proof:device.one', 'poll:session.device', 'ack:session.device:task.one', 'result:session.device:task.one'])
  const injected = await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/result', body: { sessionId: 'session.device', result: { tenantId: 'test.beta', deviceId: 'device.one', taskId: 'task.one', planId: 'plan.one', outcome: 'succeeded', summaryCode: 'ok', artifactDigests: [], completedAt: '2026-09-06T00:00:00.000Z' } } })
  assert.equal(injected.status, 400)
  assert.equal(fixture.calls.length, 5)
})
