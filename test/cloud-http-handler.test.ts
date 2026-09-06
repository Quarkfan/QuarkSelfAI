import assert from 'node:assert/strict'
import test from 'node:test'
import { InactiveCloudControlPlaneApplicationV1 } from '../src/control-plane/cloud-application.js'
import { InactiveCloudHttpHandlerV1 } from '../src/control-plane/http-handler.js'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'

const context: TenantContextV1 = { tenantId: 'test.alpha', userId: 'owner', roles: ['owner'] }

function handler(authentication?: { authenticate(input: { tenantId: string; userId: string; password: string }): Promise<{ sessionReference: string; expiresAt: string }>; revoke(reference: string): Promise<void>; resolveSession(reference: string): Promise<TenantContextV1 | undefined> }) {
  const calls: string[] = []
  const identity = { async resolveSession(reference: string) { return reference === 'session:valid' ? context : undefined } }
  const capabilities = {
    async listVisible() { calls.push('capabilities.list'); return [] },
    async registerInactive(resolved: TenantContextV1, input: { visibility: string }) { calls.push(`capabilities.register:${resolved.tenantId}:${input.visibility}`); return { tenantId: resolved.tenantId, state: 'catalogued-inactive' } as never },
    async get() { return undefined }, async close() {},
  }
  const studio = {
    async listDrafts() { calls.push('drafts.list'); return [] },
    async saveDraft(resolved: TenantContextV1, input: { draftId: string; expectedRevision: number }) { calls.push(`drafts.save:${resolved.tenantId}:${input.draftId}:${input.expectedRevision}`); return { tenantId: resolved.tenantId, draftId: input.draftId } as never },
    async publishTest(resolved: TenantContextV1, input: { draftId: string; expectedRevision: number }) { calls.push(`drafts.publish:${resolved.tenantId}:${input.draftId}:${input.expectedRevision}`); return { tenantId: resolved.tenantId, draftId: input.draftId } as never },
    async getDraft() { return undefined }, async close() {},
  }
  const devices = {
    async listDevices() { calls.push('devices.list'); return [] },
    async registerDevice(resolved: TenantContextV1, input: { deviceId: string; publicKey: string }) { calls.push(`devices.register:${resolved.tenantId}:${input.deviceId}`); return { tenantId: resolved.tenantId, userId: resolved.userId, deviceId: input.deviceId, publicKey: input.publicKey, state: 'registered' as const, createdAt: '2026-09-06T00:00:00.000Z' } },
  }
  const sessions = {
    async issueChallenge(input: { tenantId: string; userId: string; deviceId: string }) { calls.push(`challenge:${input.tenantId}:${input.deviceId}`); return { challengeId: 'challenge.one' } as never },
    async openSession(proof: { deviceId: string }) { calls.push(`proof:${proof.deviceId}`); return { sessionId: 'session.device' } as never },
    async poll(sessionId: string) { calls.push(`poll:${sessionId}`); return null },
    async acknowledge(sessionId: string, input: { taskId: string }) { calls.push(`ack:${sessionId}:${input.taskId}`); return { state: 'accepted' } as never },
    async submitResult(sessionId: string, input: { taskId: string }) { calls.push(`result:${sessionId}:${input.taskId}`); return { tenantId: 'test.alpha', userId: 'owner', ...input } as never },
  }
  const enrollment = {
    async begin(input: { tenantId: string; userId: string; deviceId: string }) { calls.push(`enrollment.begin:${input.tenantId}:${input.userId}:${input.deviceId}`); return { requestId: 'enrollment.one' } as never },
    async approve(resolved: TenantContextV1, userCode: string) { calls.push(`enrollment.approve:${resolved.tenantId}:${resolved.userId}:${userCode}`); return { state: 'approved' } as never },
    async poll(input: { requestId: string }) { calls.push(`enrollment.poll:${input.requestId}`); return { state: 'pending' } as never },
  }
  const application = new InactiveCloudControlPlaneApplicationV1(identity, capabilities, studio, devices, sessions, enrollment)
  return { handler: new InactiveCloudHttpHandlerV1(application, authentication), calls }
}

test('exposes bounded login, identity and logout without accepting a tenant on later operations', async () => {
  let active = true
  const authentication = {
    async authenticate(input: { tenantId: string; userId: string; password: string }) { if (input.password !== 'synthetic-password') throw new Error('cloud authentication failed'); return { sessionReference: 'session:valid', expiresAt: '2026-09-06T08:00:00.000Z' } },
    async revoke(reference: string) { assert.equal(reference, 'session:valid'); active = false },
    async resolveSession(reference: string) { return active && reference === 'session:valid' ? context : undefined },
  }
  const fixture = handler(authentication)
  const login = await fixture.handler.handle({ method: 'POST', path: '/v1/auth/login', body: { tenantId: 'test.alpha', userId: 'owner', password: 'synthetic-password' } })
  assert.equal(login.status, 201); assert.deepEqual(login.body.session, { sessionReference: 'session:valid', expiresAt: '2026-09-06T08:00:00.000Z' })
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/auth/login', body: { tenantId: 'test.alpha', userId: 'owner', password: 'wrong' } })).status, 401)
  assert.deepEqual((await fixture.handler.handle({ method: 'GET', path: '/v1/auth/me', sessionReference: 'session:valid' })).body.identity, context)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/auth/logout', sessionReference: 'session:valid' })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'GET', path: '/v1/auth/me', sessionReference: 'session:valid' })).status, 401)
})

test('keeps browser credentials out of the public device enrollment request and requires login only for approval', async () => {
  const fixture = handler()
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-enrollments', body: { tenantId: 'test.alpha', userId: 'owner', deviceId: 'device.one', publicKey: 'public-key' } })).status, 201)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-enrollments/poll', body: { requestId: 'enrollment.one', pollToken: 'opaque-poll-token' } })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-enrollments/approve', sessionReference: 'session:valid', body: { userCode: 'AAAA-BBBB-CCCC-DDDD' } })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-enrollments/approve', body: { userCode: 'AAAA-BBBB-CCCC-DDDD' } })).status, 401)
  assert.deepEqual(fixture.calls, ['enrollment.begin:test.alpha:owner:device.one', 'enrollment.poll:enrollment.one', 'enrollment.approve:test.alpha:owner:AAAA-BBBB-CCCC-DDDD'])
})

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

test('saves and publishes a test Agent draft without accepting tenant scope from the body', async () => {
  const fixture = handler()
  const blueprint = { schemaVersion: 1 }
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/agent-drafts', sessionReference: 'session:valid', body: { draftId: 'draft.one', blueprint, expectedRevision: 0 } })).status, 201)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/agent-drafts/publish-test', sessionReference: 'session:valid', body: { draftId: 'draft.one', expectedRevision: 1 } })).status, 201)
  assert.deepEqual(fixture.calls, ['drafts.save:test.alpha:draft.one:0', 'drafts.publish:test.alpha:draft.one:1'])
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/agent-drafts', sessionReference: 'session:valid', body: { tenantId: 'test.beta', draftId: 'draft.one', blueprint, expectedRevision: 1 } })).status, 400)
  assert.equal(fixture.calls.length, 2)
})

test('registers only a scoped inactive capability candidate without accepting tenant body fields', async () => {
  const fixture = handler()
  const candidate = { schemaVersion: 1 }
  const evidence = { schemaVersion: 1 }
  const result = await fixture.handler.handle({ method: 'POST', path: '/v1/capabilities', sessionReference: 'session:valid', body: { candidate, evidence, visibility: 'tenant' } })
  assert.equal(result.status, 201)
  assert.deepEqual(fixture.calls, ['capabilities.register:test.alpha:tenant'])
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/capabilities', sessionReference: 'session:valid', body: { tenantId: 'test.beta', candidate, evidence, visibility: 'tenant' } })).status, 400)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/capabilities', sessionReference: 'session:valid', body: { candidate, evidence, visibility: 'public' } })).status, 400)
  assert.equal(fixture.calls.length, 1)
})

test('routes device challenge, proof, poll, acknowledgement and result through one session provider', async () => {
  const fixture = handler()
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/challenge', sessionReference: 'session:valid', body: { deviceId: 'device.one' } })).status, 201)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-connect/challenge', body: { tenantId: 'test.alpha', userId: 'owner', deviceId: 'device.one' } })).status, 201)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/proof', body: { proof: { schemaVersion: 1, challengeId: 'challenge.one', deviceId: 'device.one', keyId: 'key.one', algorithm: 'ed25519', signature: 'signature' } } })).status, 201)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/poll', body: { sessionId: 'session.device' } })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/ack', body: { sessionId: 'session.device', leaseToken: 'lease.one', taskId: 'task.one' } })).status, 200)
  assert.equal((await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/result', body: { sessionId: 'session.device', result: { deviceId: 'device.one', taskId: 'task.one', planId: 'plan.one', outcome: 'succeeded', summaryCode: 'ok', artifactDigests: [], completedAt: '2026-09-06T00:00:00.000Z' } } })).status, 200)
  assert.deepEqual(fixture.calls, ['challenge:test.alpha:device.one', 'challenge:test.alpha:device.one', 'proof:device.one', 'poll:session.device', 'ack:session.device:task.one', 'result:session.device:task.one'])
  const injected = await fixture.handler.handle({ method: 'POST', path: '/v1/device-sessions/result', body: { sessionId: 'session.device', result: { tenantId: 'test.beta', deviceId: 'device.one', taskId: 'task.one', planId: 'plan.one', outcome: 'succeeded', summaryCode: 'ok', artifactDigests: [], completedAt: '2026-09-06T00:00:00.000Z' } } })
  assert.equal(injected.status, 400)
  assert.equal(fixture.calls.length, 6)
})
