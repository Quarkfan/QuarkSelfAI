import assert from 'node:assert/strict'
import test from 'node:test'
import type { DeviceRecordV1, DispatchRecordV1 } from '../src/control-plane/contracts.js'
import { InactiveDeviceSyncCoordinatorV1 } from '../src/client-runtime/inactive-sync.js'

const at = new Date('2026-09-06T00:00:00.000Z')

function tokens() {
  let sequence = 0
  return { next: (label: 'challenge' | 'nonce' | 'session' | 'lease') => `${label}.${++sequence}` }
}

function device(tenantId: string, userId = 'user.owner', deviceId = 'device.owner'): DeviceRecordV1 {
  return { tenantId, userId, deviceId, publicKey: `public:${tenantId}`, state: 'registered', createdAt: at.toISOString() }
}

function dispatch(tenantId: string, taskId: string, userId = 'user.owner', deviceId = 'device.owner'): DispatchRecordV1 {
  return {
    tenantId, userId, deviceId, taskId, idempotencyKey: `${tenantId}/${taskId}`, state: 'queued', createdAt: at.toISOString(),
    plan: {
      schemaVersion: 1, planId: `plan.${taskId}`, issuedAt: at.toISOString(), expiresAt: '2026-09-06T02:00:00.000Z',
      keyId: 'test-key', algorithm: 'ed25519', payloadDigest: `sha256:${'a'.repeat(64)}`, signature: 'signed',
      envelope: { tenantId, userId, deviceId, allowedEffects: [], approvalGrants: [] },
    },
  } as unknown as DispatchRecordV1
}

async function session(coordinator: InactiveDeviceSyncCoordinatorV1, tenantId: string, userId = 'user.owner', deviceId = 'device.owner') {
  coordinator.registerDevice(device(tenantId, userId, deviceId))
  const challenge = coordinator.issueChallenge({ tenantId, userId, deviceId }, at)
  return coordinator.openSession({ schemaVersion: 1, challengeId: challenge.challengeId, deviceId, keyId: 'device-key', algorithm: 'ed25519', signature: `signed:${challenge.nonce}` }, {
    verify: async input => input.signature === `signed:${input.challenge}`,
  }, at)
}

test('authenticates a registered test device and enforces one active session per device', async () => {
  const coordinator = new InactiveDeviceSyncCoordinatorV1(tokens())
  const first = await session(coordinator, 'test.alpha')
  const challenge = coordinator.issueChallenge({ tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner' }, at)
  const second = await coordinator.openSession({ schemaVersion: 1, challengeId: challenge.challengeId, deviceId: 'device.owner', keyId: 'device-key', algorithm: 'ed25519', signature: `signed:${challenge.nonce}` }, { verify: async () => true }, at)
  assert.equal(coordinator.session(first.sessionId)?.state, 'superseded')
  assert.equal(coordinator.session(second.sessionId)?.state, 'active')
  assert.throws(() => coordinator.poll(first.sessionId, at), /not active/)
})

test('leases one scoped no-effect task idempotently and retries only after expiry', async () => {
  const coordinator = new InactiveDeviceSyncCoordinatorV1(tokens())
  const active = await session(coordinator, 'test.alpha')
  coordinator.enqueue(dispatch('test.alpha', 'task.001'))
  const first = coordinator.poll(active.sessionId, at, 1_000)!
  assert.equal(first.attempt, 1)
  assert.equal(first.externalWritesEnabled, false)
  assert.equal(coordinator.poll(active.sessionId, new Date(at.getTime() + 500))?.leaseToken, first.leaseToken)
  const retried = coordinator.poll(active.sessionId, new Date(at.getTime() + 1_001), 1_000)!
  assert.equal(retried.attempt, 2)
  assert.notEqual(retried.leaseToken, first.leaseToken)
  assert.equal(coordinator.acknowledge(active.sessionId, retried.leaseToken, retried.taskId, new Date(at.getTime() + 1_100)).state, 'leased')
})

test('isolates tenant tasks and rejects replayed challenges, foreign leases and effects', async () => {
  const coordinator = new InactiveDeviceSyncCoordinatorV1(tokens())
  const alpha = await session(coordinator, 'test.alpha')
  const beta = await session(coordinator, 'test.beta')
  coordinator.enqueue(dispatch('test.alpha', 'task.same'))
  coordinator.enqueue(dispatch('test.beta', 'task.same'))
  const alphaLease = coordinator.poll(alpha.sessionId, at)!
  const betaLease = coordinator.poll(beta.sessionId, at)!
  assert.notEqual(alphaLease.leaseToken, betaLease.leaseToken)
  assert.throws(() => coordinator.acknowledge(beta.sessionId, alphaLease.leaseToken, alphaLease.taskId, at), /out of scope/)
  const effectful = dispatch('test.alpha', 'task.effect') as unknown as { plan: { envelope: { allowedEffects: string[] } } }
  effectful.plan.envelope.allowedEffects = ['message.send']
  assert.throws(() => coordinator.enqueue(effectful as unknown as DispatchRecordV1), /rejects effectful/)

  const challenge = coordinator.issueChallenge({ tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner' }, at)
  const proof = { schemaVersion: 1 as const, challengeId: challenge.challengeId, deviceId: 'device.owner', keyId: 'device-key', algorithm: 'ed25519' as const, signature: 'signed' }
  await coordinator.openSession(proof, { verify: async () => true }, at)
  await assert.rejects(() => coordinator.openSession(proof, { verify: async () => true }, at), /unavailable/)
})

test('rejects device key drift, duplicate idempotency ownership and reused entropy', async () => {
  const coordinator = new InactiveDeviceSyncCoordinatorV1(tokens())
  const active = await session(coordinator, 'test.alpha')
  assert.throws(() => coordinator.registerDevice({ ...device('test.alpha'), publicKey: 'public:changed' }), /cannot drift/)
  coordinator.enqueue(dispatch('test.alpha', 'task.001'))
  const duplicateKey = { ...dispatch('test.alpha', 'task.002'), idempotencyKey: 'test.alpha/task.001' }
  assert.throws(() => coordinator.enqueue(duplicateKey), /another task/)
  assert.ok(coordinator.poll(active.sessionId, at))

  const repeated = new InactiveDeviceSyncCoordinatorV1({ next: () => 'same.token' })
  repeated.registerDevice(device('test.alpha'))
  assert.throws(() => repeated.issueChallenge({ tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner' }, at), /reused/)
})
