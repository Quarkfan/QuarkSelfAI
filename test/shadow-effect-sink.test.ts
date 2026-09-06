import assert from 'node:assert/strict'
import test from 'node:test'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import type { SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { ShadowEffectRecordingSinkV1 } from '../src/orchestration/shadow-effect-sink.js'

const at = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T01:00:00.000Z'
const sha = `sha256:${'a'.repeat(64)}`

function plan(): SignedExecutionPlanV1 {
  const unsigned = {
    schemaVersion: 1 as const, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', agentId: 'agent/demo', runId: 'run.001', actionId: 'action.001',
    blueprint: { id: 'agent/demo', version: '1.0.0', digest: sha }, capabilities: [], context: [], workspaceGrants: [],
    approvalGrants: [{ grantId: 'grant.effect', tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', agentId: 'agent/demo', releaseDigest: sha, actionId: 'action.001', effectKind: 'message.send', scope: 'owner-dm', grantedAt: at.toISOString(), expiresAt: later, singleUse: true }],
    idempotencyKey: 'run.001/action.001', deadline: later, budget: { tokens: 1, durationMs: 1000, costMinorUnits: 0 }, dataClasses: [], allowedEffects: ['message.send'], continuity: { sessionId: null, continuationToken: null, fallbackAllowed: false, midActionSwitchAllowed: false as const }, plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'test-key' },
  }
  const digest = executionEnvelopePayloadDigest(unsigned)
  const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'test-key' } }
  return { schemaVersion: 1, planId: 'plan.001', issuedAt: at.toISOString(), expiresAt: later, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
}

const verifier = { verify: async ({ payloadDigest, signature }: { payloadDigest: string; signature: string }) => signature === `signed:${payloadDigest}` }

test('records an exactly approved effect without owning an effect provider', async () => {
  const sink = await ShadowEffectRecordingSinkV1.open(plan(), verifier, at)
  const input = { effectKind: 'message.send', scope: 'owner-dm', inputDigest: sha, idempotencyKey: 'effect.001' }
  const first = sink.record(input, at)
  assert.equal(first.state, 'recorded-not-executed')
  assert.equal(first.effectExecuted, false)
  assert.equal('scope' in first, false)
  assert.equal(sink.record(input, at), first)
  assert.deepEqual({ mode: sink.snapshot().mode, count: sink.snapshot().recordCount, executed: sink.snapshot().effectExecuted }, { mode: 'recording-sink', count: 1, executed: false })
})

test('fails closed on unsigned plans, missing grants and single-use drift', async () => {
  const invalid = plan()
  await assert.rejects(() => ShadowEffectRecordingSinkV1.open({ ...invalid, signature: 'wrong', envelope: { ...invalid.envelope, plan: { ...invalid.envelope.plan, signature: 'wrong' } } }, verifier, at), /signature is invalid/)
  const sink = await ShadowEffectRecordingSinkV1.open(plan(), verifier, at)
  assert.throws(() => sink.record({ effectKind: 'message.send', scope: 'another-scope', inputDigest: sha, idempotencyKey: 'effect.002' }, at), /exact active approval/)
  sink.record({ effectKind: 'message.send', scope: 'owner-dm', inputDigest: sha, idempotencyKey: 'effect.001' }, at)
  assert.throws(() => sink.record({ effectKind: 'message.send', scope: 'owner-dm', inputDigest: `sha256:${'b'.repeat(64)}`, idempotencyKey: 'effect.002' }, at), /single-use approval/)
})
