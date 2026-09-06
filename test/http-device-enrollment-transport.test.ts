import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NodeInactiveHttpDeviceEnrollmentTransportV1 } from '../src/client-runtime/http-device-enrollment-transport.js'
import { InactiveCloudControlPlaneApplicationV1 } from '../src/control-plane/cloud-application.js'
import type { DeviceRecordV1, TenantContextV1, TenantDevicePortV1 } from '../src/control-plane/contracts.js'
import { openSqliteInactiveDeviceEnrollment } from '../src/control-plane/device-enrollment.js'
import { InactiveCloudHttpHandlerV1 } from '../src/control-plane/http-handler.js'
import { openEphemeralLoopbackCloudEdge } from '../src/control-plane/node-http-adapter.js'

const requestId = `enrollment.${'a'.repeat(32)}`
const pollToken = 'A'.repeat(43)
const expiresAt = '2026-09-06T12:00:00.000Z'
const identity = { tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', publicKey: `MCowBQYDK2VwAyEA${'A'.repeat(64)}` }

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

test('uses only the public begin and poll routes with credentials omitted', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input); calls.push({ url, ...(init ? { init } : {}) })
    if (url.endsWith('/v1/device-enrollments')) return json({ code: 'created', item: { schemaVersion: 1, requestId, userCode: 'AAAA-BBBB-CCCC-DDDD', pollToken, verificationPath: '/devices/activate', expiresAt, pollAfterSeconds: 5 } }, { status: 201 })
    return json({ code: 'ok', item: { schemaVersion: 1, requestId, deviceId: identity.deviceId, state: 'approved', expiresAt } })
  }) as typeof fetch
  const transport = new NodeInactiveHttpDeviceEnrollmentTransportV1('https://control.example.com/', 1000, fetcher)
  const begun = await transport.begin(identity)
  const polled = await transport.poll({ requestId, pollToken })
  assert.equal(begun.pollToken, pollToken)
  assert.equal(polled.state, 'approved')
  assert.deepEqual(calls.map(call => call.url), ['https://control.example.com/v1/device-enrollments', 'https://control.example.com/v1/device-enrollments/poll'])
  for (const call of calls) {
    assert.equal(call.init?.method, 'POST')
    assert.equal(call.init?.credentials, 'omit')
    assert.equal(call.init?.redirect, 'error')
    const headers = call.init?.headers as Record<string, string>
    assert.deepEqual(headers, { accept: 'application/json', 'content-type': 'application/json' })
    assert.equal('authorization' in headers, false)
    assert.equal('cookie' in headers, false)
  }
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), identity)
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { requestId, pollToken })
})

test('rejects unsafe endpoints before any request', () => {
  for (const endpoint of ['http://example.com/', 'http://localhost:1234/', 'https://user@example.com/', 'https://example.com/path', 'https://example.com/?token=x', 'https://example.com/#x']) {
    assert.throws(() => new NodeInactiveHttpDeviceEnrollmentTransportV1(endpoint), /HTTPS or explicit ephemeral/)
  }
  assert.doesNotThrow(() => new NodeInactiveHttpDeviceEnrollmentTransportV1('http://127.0.0.1:43123/'))
})

test('fails closed on redirects, oversized bodies, unknown fields and schema drift', async () => {
  const redirected = json({ code: 'created', item: {} }, { status: 201 })
  Object.defineProperty(redirected, 'redirected', { value: true })
  const cases: Array<{ response: Response; pattern: RegExp }> = [
    { response: redirected, pattern: /redirect/ },
    { response: new Response('{}', { headers: { 'content-length': '65537' } }), pattern: /too large/ },
    { response: json({ code: 'created', item: { schemaVersion: 1, requestId, userCode: 'AAAA-BBBB-CCCC-DDDD', pollToken, verificationPath: '/devices/activate', expiresAt, pollAfterSeconds: 5, extra: true } }, { status: 201 }), pattern: /fields/ },
    { response: json({ code: 'created', item: { schemaVersion: 1, requestId: 'wrong', userCode: 'AAAA-BBBB-CCCC-DDDD', pollToken, verificationPath: '/devices/activate', expiresAt, pollAfterSeconds: 5 } }, { status: 201 }), pattern: /invalid request/ }
  ]
  for (const item of cases) {
    const transport = new NodeInactiveHttpDeviceEnrollmentTransportV1('https://control.example.com/', 1000, (async () => item.response) as typeof fetch)
    await assert.rejects(transport.begin(identity), item.pattern)
  }
})

test('stops an unannounced streaming response at the byte limit', async () => {
  const oversized = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(40_000)); controller.close() } }))
  const transport = new NodeInactiveHttpDeviceEnrollmentTransportV1('https://control.example.com/', 1000, (async () => oversized) as typeof fetch)
  await assert.rejects(transport.begin(identity), /too large/)
})

test('does not echo poll credentials or server response bodies in errors', async () => {
  const secretBody = `customer-secret-${pollToken}`
  const transport = new NodeInactiveHttpDeviceEnrollmentTransportV1('https://control.example.com/', 1000, (async () => json({ code: secretBody, item: null }, { status: 403 })) as typeof fetch)
  await assert.rejects(transport.poll({ requestId, pollToken }), error => {
    const message = String(error)
    assert.doesNotMatch(message, /customer-secret/)
    assert.doesNotMatch(message, new RegExp(pollToken))
    return true
  })
})

test('validates exact poll request identity and status schema', async () => {
  const valid = { code: 'ok', item: { schemaVersion: 1, requestId, deviceId: identity.deviceId, state: 'pending', expiresAt } }
  const transport = new NodeInactiveHttpDeviceEnrollmentTransportV1('https://control.example.com/', 1000, (async () => json(valid)) as typeof fetch)
  assert.equal((await transport.poll({ requestId, pollToken })).state, 'pending')
  await assert.rejects(transport.poll({ requestId: `enrollment.${'b'.repeat(32)}`, pollToken }), /invalid status/)
  const extra = new NodeInactiveHttpDeviceEnrollmentTransportV1('https://control.example.com/', 1000, (async () => json({ code: 'ok', item: { ...valid.item, extra: true } })) as typeof fetch)
  await assert.rejects(extra.poll({ requestId, pollToken }), /fields/)
})

test('completes begin and poll through the bounded real loopback edge without a client session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-http-enrollment-'))
  const migration = new URL('../migrations/control-plane-sqlite/005_device_enrollment.sql', import.meta.url).pathname
  const owner: TenantContextV1 = { tenantId: 'tenant.alpha', userId: 'user.owner', roles: ['owner'] }
  const records: DeviceRecordV1[] = []
  const devices: TenantDevicePortV1 = {
    async registerDevice(context, input, now = new Date()) { const record = { ...input, tenantId: context.tenantId, userId: context.userId, state: 'registered' as const, createdAt: now.toISOString() }; records.push(record); return record },
    async listDevices() { return records }
  }
  let edge: Awaited<ReturnType<typeof openEphemeralLoopbackCloudEdge>> | undefined
  let enrollment: Awaited<ReturnType<typeof openSqliteInactiveDeviceEnrollment>> | undefined
  try {
    enrollment = await openSqliteInactiveDeviceEnrollment(join(directory, 'server.sqlite3'), migration, devices)
    const unused = { async listVisible() { return [] }, async registerInactive() { throw new Error('unused') }, async get() { return undefined }, async close() {} }
    const studio = { async listDrafts() { return [] }, async saveDraft() { throw new Error('unused') }, async publishTest() { throw new Error('unused') }, async getDraft() { return undefined }, async close() {} }
    const application = new InactiveCloudControlPlaneApplicationV1({ async resolveSession(reference) { return reference === 'session:owner' ? owner : undefined } }, unused, studio, devices, undefined, enrollment)
    const handler = new InactiveCloudHttpHandlerV1(application)
    edge = await openEphemeralLoopbackCloudEdge(handler)
    const transport = new NodeInactiveHttpDeviceEnrollmentTransportV1(`http://${edge.host}:${edge.port}/`)
    const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
    const begun = await transport.begin({ tenantId: owner.tenantId, userId: owner.userId, deviceId: 'device.owner', publicKey })
    assert.equal((await transport.poll({ requestId: begun.requestId, pollToken: begun.pollToken })).state, 'pending')
    assert.equal((await handler.handle({ method: 'POST', path: '/v1/device-enrollments/approve', sessionReference: 'session:owner', body: { userCode: begun.userCode } })).status, 200)
    assert.equal((await transport.poll({ requestId: begun.requestId, pollToken: begun.pollToken })).state, 'approved')
    assert.deepEqual({ requests: edge.requestCount(), devices: records.length }, { requests: 3, devices: 1 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit loopback listeners'); return }
    throw error
  } finally {
    if (edge) await edge.close()
    if (enrollment) await enrollment.close()
    await rm(directory, { recursive: true, force: true })
  }
})
