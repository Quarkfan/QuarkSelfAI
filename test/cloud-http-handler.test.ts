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
  const application = new InactiveCloudControlPlaneApplicationV1(identity, capabilities, studio, devices)
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
