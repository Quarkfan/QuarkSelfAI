import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import type { SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import type { DispatchRecordV1, TenantContextV1 } from '../src/control-plane/contracts.js'
import { openSqliteInactiveDeviceSessionProvider } from '../src/control-plane/sqlite-device-session-provider.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

const identityMigration = new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname
const sessionMigration = new URL('../migrations/control-plane-sqlite/004_device_sessions.sql', import.meta.url).pathname
const migrations = [identityMigration, sessionMigration]
const at = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T01:00:00.000Z'
const sha = `sha256:${'a'.repeat(64)}`
const alpha: TenantContextV1 = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] }
const beta: TenantContextV1 = { tenantId: 'test.beta', userId: 'user.owner', roles: ['owner'] }
const proofVerifier = { verify: async ({ challenge, signature }: { challenge: string; signature: string }) => signature === `signed:${challenge}` }
const planVerifier = { verify: async ({ payloadDigest, signature }: { payloadDigest: string; signature: string }) => signature === `signed:${payloadDigest}` }

function tokenSource() { let sequence = 0; return { next: (label: 'challenge' | 'nonce' | 'session' | 'lease') => `${label}.${++sequence}` } }

function plan(context: TenantContextV1, taskId: string, deviceId = 'device.owner'): SignedExecutionPlanV1 {
  const unsigned = {
    schemaVersion: 1 as const, tenantId: context.tenantId, userId: context.userId, deviceId, agentId: 'agent.demo', runId: `run.${taskId}`, actionId: `action.${taskId}`,
    blueprint: { id: 'agent.demo', version: '1.0.0', digest: sha }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [], idempotencyKey: `${context.tenantId}.${taskId}`, deadline: later,
    budget: { tokens: 1, durationMs: 1000, costMinorUnits: 0 }, dataClasses: ['public'], allowedEffects: [], continuity: { sessionId: null, continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false as const }, plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'test-key' },
  }
  const digest = executionEnvelopePayloadDigest(unsigned)
  const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'test-key' } }
  return { schemaVersion: 1, planId: `plan.${taskId}`, issuedAt: at.toISOString(), expiresAt: later, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
}

function dispatch(context: TenantContextV1, taskId: string): DispatchRecordV1 {
  return { tenantId: context.tenantId, userId: context.userId, deviceId: 'device.owner', taskId, plan: plan(context, taskId), idempotencyKey: `${context.tenantId}.${taskId}`, state: 'queued', createdAt: at.toISOString() }
}

async function provision(database: string): Promise<void> {
  const repository = await openSqliteTenantControlRepository(database, identityMigration)
  const service = new TenantControlServiceV1(repository, { authorize: async () => true })
  for (const context of [alpha, beta]) {
    await service.createTenant(context, { name: context.tenantId }, at)
    await service.registerUser(context, { userId: context.userId, displayName: 'Owner' }, at)
    await service.registerDevice(context, { deviceId: 'device.owner', publicKey: `public.${context.tenantId}` }, at)
  }
  await repository.close()
}

async function openSession(provider: Awaited<ReturnType<typeof openSqliteInactiveDeviceSessionProvider>>, context: TenantContextV1) {
  const challenge = await provider.issueChallenge(context, 'device.owner', at)
  const session = await provider.openSession({ schemaVersion: 1, challengeId: challenge.challengeId, deviceId: challenge.deviceId, keyId: 'device-key', algorithm: 'ed25519', signature: `signed:${challenge.nonce}` }, at)
  return { challenge, session }
}

test('persists tenant-isolated sessions, leases and privacy-bounded results without effects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-device-session-'))
  const database = join(directory, 'control-plane.sqlite3')
  const tokens = tokenSource()
  try {
    await provision(database)
    let provider = await openSqliteInactiveDeviceSessionProvider(database, migrations, tokens, proofVerifier, planVerifier)
    const alphaSession = await openSession(provider, alpha)
    const betaSession = await openSession(provider, beta)
    await assert.rejects(() => provider.openSession({ schemaVersion: 1, challengeId: alphaSession.challenge.challengeId, deviceId: 'device.owner', keyId: 'device-key', algorithm: 'ed25519', signature: `signed:${alphaSession.challenge.nonce}` }, at), /unavailable/)
    await provider.enqueue(dispatch(alpha, 'task.one'), at)
    await provider.enqueue(dispatch(beta, 'task.one'), at)
    const alphaPolls = await Promise.all([provider.poll(alphaSession.session.sessionId, at), provider.poll(alphaSession.session.sessionId, at)])
    const alphaLease = alphaPolls[0]
    const betaLease = await provider.poll(betaSession.session.sessionId, at)
    assert.ok(alphaLease && betaLease)
    assert.equal(new Set(alphaPolls.map(item => item?.leaseToken)).size, 1)
    assert.notEqual(alphaLease.leaseToken, betaLease.leaseToken)
    await assert.rejects(() => provider.acknowledge(betaSession.session.sessionId, { leaseToken: alphaLease.leaseToken, taskId: alphaLease.taskId }, at), /out of scope/)
    await provider.acknowledge(alphaSession.session.sessionId, { leaseToken: alphaLease.leaseToken, taskId: alphaLease.taskId }, at)
    const input = { deviceId: 'device.owner', taskId: 'task.one', planId: alphaLease.planId, outcome: 'succeeded' as const, summaryCode: 'fixture.complete', artifactDigests: [sha], completedAt: at.toISOString() }
    const result = await provider.submitResult(alphaSession.session.sessionId, input, at)
    assert.deepEqual({ tenantId: result.tenantId, userId: result.userId, summaryCode: result.summaryCode }, { tenantId: alpha.tenantId, userId: alpha.userId, summaryCode: 'fixture.complete' })
    await provider.close()

    provider = await openSqliteInactiveDeviceSessionProvider(database, migrations, tokens, proofVerifier, planVerifier)
    const reopened = await openSession(provider, alpha)
    assert.deepEqual(await provider.submitResult(reopened.session.sessionId, input, at), result)
    await assert.rejects(() => provider.submitResult(reopened.session.sessionId, { ...input, summaryCode: '/Users/demo/output' }, at), /privacy bounded|different evidence/)
    await provider.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rejects effectful, expired and idempotency-conflicting dispatches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-device-session-'))
  const database = join(directory, 'control-plane.sqlite3')
  try {
    await provision(database)
    const provider = await openSqliteInactiveDeviceSessionProvider(database, migrations, tokenSource(), proofVerifier, planVerifier)
    await provider.enqueue(dispatch(alpha, 'task.one'), at)
    await assert.rejects(() => provider.enqueue({ ...dispatch(alpha, 'task.two'), idempotencyKey: dispatch(alpha, 'task.one').idempotencyKey }, at), /already assigned/)
    const effectful = dispatch(alpha, 'task.effect') as unknown as { plan: { envelope: { allowedEffects: string[] } } }
    effectful.plan.envelope.allowedEffects = ['message.send']
    await assert.rejects(() => provider.enqueue(effectful as unknown as DispatchRecordV1, at), /no-effect/)
    const opened = await openSession(provider, alpha)
    await assert.rejects(() => provider.poll(opened.session.sessionId, new Date(later)), /expired/)
    await provider.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
