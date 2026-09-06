import assert from 'node:assert/strict'
import test from 'node:test'
import type { SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { InactiveTestTenantControlPlaneV1 } from '../src/control-plane/test-tenant-store.js'

const sha = `sha256:${'a'.repeat(64)}`
const now = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T01:00:00.000Z'
const owner = (tenantId: string, userId = 'user.owner') => ({ tenantId, userId, roles: ['owner'] as const })

function plan(tenantId: string, userId: string, deviceId: string, allowedEffects: string[] = []): SignedExecutionPlanV1 {
  return {
    schemaVersion: 1, planId: 'plan.001', issuedAt: now.toISOString(), expiresAt: later, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: sha, signature: 'fixture',
    envelope: {
      schemaVersion: 1, tenantId, userId, deviceId, agentId: 'agent.demo', runId: 'run.001', actionId: 'action.001',
      blueprint: { id: 'agent/demo', version: '1.0.0', digest: sha }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [],
      idempotencyKey: 'dispatch.001', deadline: later, budget: { tokens: 100, durationMs: 1000, costMinorUnits: 1 }, dataClasses: [], allowedEffects,
      continuity: { sessionId: null, continuationToken: null, fallbackAllowed: false, midActionSwitchAllowed: false },
      plan: { digest: sha, signature: 'fixture', keyId: 'test-key' },
    },
  }
}

test('partitions identical user and device ids by tenant without a cross-tenant administrator bypass', () => {
  const store = new InactiveTestTenantControlPlaneV1()
  for (const tenantId of ['test.alpha', 'test.beta']) {
    store.createTestTenant({ tenantId, name: tenantId }, now)
    store.registerUser(owner(tenantId), { userId: 'user.owner', displayName: 'Owner' }, now)
    store.registerDevice(owner(tenantId), { deviceId: 'device.same', publicKey: `public-${tenantId}` }, now)
  }
  assert.equal(store.getDevice(owner('test.alpha'), 'device.same')?.publicKey, 'public-test.alpha')
  assert.equal(store.getDevice(owner('test.beta'), 'device.same')?.publicKey, 'public-test.beta')
  assert.throws(() => store.getDevice(owner('test.missing'), 'device.same'), /tenant is unavailable/)
})

test('keeps user device and task scopes isolated inside a tenant', () => {
  const store = new InactiveTestTenantControlPlaneV1()
  const admin = owner('test.alpha')
  store.createTestTenant({ tenantId: admin.tenantId, name: 'Alpha' }, now)
  store.registerUser(admin, { userId: admin.userId, displayName: 'Owner' }, now)
  store.registerUser(admin, { userId: 'user.member', displayName: 'Member' }, now)
  store.registerDevice(admin, { deviceId: 'device.owner', publicKey: 'public-owner' }, now)
  const member = { tenantId: 'test.alpha', userId: 'user.member', roles: ['member'] as const }
  store.registerDevice(member, { deviceId: 'device.member', publicKey: 'public-member' }, now)
  assert.equal(store.getDevice(member, 'device.owner'), undefined)
  assert.throws(() => store.listAudits(member), /audit role/)
  assert.throws(() => store.dispatch(member, { taskId: 'task.001', deviceId: 'device.owner', plan: plan('test.alpha', 'user.member', 'device.owner'), idempotencyKey: 'task.001' }, now), /outside the tenant user scope/)
})

test('queues only idempotent no-effect test dispatches and accepts privacy-bounded results', () => {
  const store = new InactiveTestTenantControlPlaneV1()
  const context = owner('test.alpha')
  store.createTestTenant({ tenantId: context.tenantId, name: 'Alpha' }, now)
  store.registerUser(context, { userId: context.userId, displayName: 'Owner' }, now)
  store.registerDevice(context, { deviceId: 'device.owner', publicKey: 'public-owner' }, now)
  const input = { taskId: 'task.001', deviceId: 'device.owner', plan: plan(context.tenantId, context.userId, 'device.owner'), idempotencyKey: 'idem.001' }
  const first = store.dispatch(context, input, now)
  assert.equal(store.dispatch(context, { ...input, taskId: 'task.duplicate' }, now), first)
  assert.throws(() => store.dispatch(context, { ...input, taskId: 'task.effect', idempotencyKey: 'idem.effect', plan: plan(context.tenantId, context.userId, 'device.owner', ['message.send']) }, now), /no-effect/)
  assert.equal(store.acknowledgeLease(context, { taskId: first.taskId, planId: first.plan.planId, deviceId: first.deviceId }, now).state, 'leased')
  assert.equal(store.complete(context, { taskId: 'task.001', outcome: 'succeeded', summaryCode: 'completed', artifactDigests: [sha], completedAt: later }).summaryCode, 'completed')
  assert.equal(store.getDispatch(context, 'task.001')?.state, 'completed')
  assert.throws(() => store.complete(context, { taskId: 'task.001', outcome: 'failed', summaryCode: '/Users/demo/output', artifactDigests: [], completedAt: later }), /privacy bounded/)
  assert.ok(store.listAudits(context).every(item => item.tenantId === context.tenantId && !('payload' in item)))
})
