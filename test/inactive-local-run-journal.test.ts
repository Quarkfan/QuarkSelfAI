import assert from 'node:assert/strict'
import test from 'node:test'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import type { DeviceTaskLeaseV1, SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { InactiveLocalRunJournalV1 } from '../src/client-runtime/inactive-run-journal.js'

const at = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T01:00:00.000Z'
const sha = `sha256:${'a'.repeat(64)}`
const verifier = { verify: async ({ payloadDigest, signature }: { payloadDigest: string; signature: string }) => signature === `signed:${payloadDigest}` }

function signedPlan(): SignedExecutionPlanV1 {
  const unsigned = {
    schemaVersion: 1 as const, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', agentId: 'agent/demo', runId: 'run.001', actionId: 'action.001',
    blueprint: { id: 'agent/demo', version: '1.0.0', digest: sha }, program: { role: 'worker', goals: ['Complete the fixture'], graph: { nodes: [], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } }, capabilities: [], context: [{ id: 'context.1', kind: 'fixture', dataClass: 'public', location: 'local' as const, opaqueReference: 'context:one' }], workspaceGrants: [], approvalGrants: [], idempotencyKey: 'run.001/action.001', deadline: later,
    budget: { tokens: 1, durationMs: 1000, costMinorUnits: 0 }, dataClasses: ['public'], allowedEffects: [], executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: [], allowedExecutors: ['executor-a'], preferredExecutors: ['executor-a'] }, continuity: { sessionId: null, continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false as const }, plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'test-key' },
  }
  const digest = executionEnvelopePayloadDigest(unsigned)
  const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'test-key' } }
  return { schemaVersion: 1, planId: 'plan.001', issuedAt: at.toISOString(), expiresAt: later, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
}

function lease(): DeviceTaskLeaseV1 {
  const plan = signedPlan()
  return { schemaVersion: 1, taskId: 'task.001', planId: plan.planId, plan, deviceId: plan.envelope.deviceId, leaseToken: 'lease.local', attempt: 1, leasedAt: at.toISOString(), expiresAt: later, externalWritesEnabled: false }
}

test('checkpoints a no-effect local run and retains a result while disconnected', async () => {
  const journal = new InactiveLocalRunJournalV1(verifier)
  const accepted = await journal.acceptLease(lease(), 'codex', at)
  assert.equal(accepted.state, 'leased')
  assert.equal('leaseToken' in accepted, false)
  journal.markLeaseAcknowledged(accepted.taskId, at)
  journal.begin(accepted.taskId, at)
  journal.pause(accepted.taskId, at)
  journal.begin(accepted.taskId, at)
  const pending = journal.completePendingSync(accepted.taskId, { outcome: 'succeeded', summaryCode: 'fixture-complete', artifactDigests: [sha] }, at)
  assert.equal(pending.state, 'completed-pending-sync')
  assert.deepEqual(journal.resultForSync(accepted.taskId), pending.result)
  const restored = await InactiveLocalRunJournalV1.restore(journal.exportCheckpoints(), verifier, at)
  assert.equal(restored.resultForSync(accepted.taskId).planId, accepted.plan.planId)
  assert.equal(restored.markSynced(accepted.taskId, at).state, 'synced')
})

test('fails closed on effectful plans, checkpoint tampering and unsafe result summaries', async () => {
  const journal = new InactiveLocalRunJournalV1(verifier)
  const effectful = lease() as unknown as { plan: { envelope: { allowedEffects: string[] } } }
  effectful.plan.envelope.allowedEffects = ['message.send']
  await assert.rejects(() => journal.acceptLease(effectful as unknown as DeviceTaskLeaseV1, 'codex', at), /no-effect plans/)
  const accepted = await journal.acceptLease(lease(), 'codex', at)
  journal.markLeaseAcknowledged(accepted.taskId, at)
  journal.begin(accepted.taskId, at)
  assert.throws(() => journal.completePendingSync(accepted.taskId, { outcome: 'failed', summaryCode: '/Users/demo/output', artifactDigests: [] }, at), /privacy bounded/)
  const exported = journal.exportCheckpoints()
  await assert.rejects(() => InactiveLocalRunJournalV1.restore([{ ...exported[0]!, executorId: 'dsh' }], verifier, at), /integrity failed/)
})

test('restores an interrupted running task as paused instead of executing it twice', async () => {
  const journal = new InactiveLocalRunJournalV1(verifier)
  const accepted = await journal.acceptLease(lease(), 'codex', at)
  journal.markLeaseAcknowledged(accepted.taskId, at)
  journal.begin(accepted.taskId, at)
  const restored = await InactiveLocalRunJournalV1.restore(journal.exportCheckpoints(), verifier, at)
  assert.equal(restored.exportCheckpoints()[0]?.state, 'paused')
  assert.equal(restored.exportCheckpoints()[0]?.revision, 4)
})
