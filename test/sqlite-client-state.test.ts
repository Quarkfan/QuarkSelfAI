import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import type { DeviceTaskLeaseV1, SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { InactiveLocalRunJournalV1 } from '../src/client-runtime/inactive-run-journal.js'
import { openSqliteInactiveClientState } from '../src/client-runtime/sqlite-client-state.js'

const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const at = new Date('2026-09-06T00:00:00.000Z'); const later = '2026-09-06T01:00:00.000Z'; const sha = `sha256:${'a'.repeat(64)}`
const verifier = { verify: async ({ payloadDigest, signature }: { payloadDigest: string; signature: string }) => signature === `signed:${payloadDigest}` }
const identity = { schemaVersion: 1 as const, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', publicKey: 'public.opaque', keyAlgorithm: 'ed25519' as const, createdAt: at.toISOString(), attestation: { kind: 'self' as const, reference: 'attestation.opaque' } }

function lease(): DeviceTaskLeaseV1 {
  const unsigned = { schemaVersion: 1 as const, tenantId: identity.tenantId, userId: identity.userId, deviceId: identity.deviceId, agentId: 'agent.demo', runId: 'run.one', actionId: 'action.one', blueprint: { id: 'agent.demo', version: '1.0.0', digest: sha }, program: { role: 'worker', goals: ['Complete the fixture'], graph: { nodes: [], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [], idempotencyKey: 'run.one/action.one', deadline: later, budget: { tokens: 1, durationMs: 1000, costMinorUnits: 0 }, dataClasses: ['public'], allowedEffects: [], executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: [], allowedExecutors: ['executor-a'], preferredExecutors: ['executor-a'] }, continuity: { sessionId: null, continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false as const }, plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'test-key' } }
  const digest = executionEnvelopePayloadDigest(unsigned); const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'test-key' } }
  const plan: SignedExecutionPlanV1 = { schemaVersion: 1, planId: 'plan.one', issuedAt: at.toISOString(), expiresAt: later, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
  return { schemaVersion: 1, taskId: 'task.one', planId: plan.planId, plan, deviceId: identity.deviceId, leaseToken: 'lease.one', attempt: 1, leasedAt: at.toISOString(), expiresAt: later, externalWritesEnabled: false }
}

test('persists local identity, workspace mapping, reports and checkpoints without projecting secrets or paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-state-')); const database = join(directory, 'client.sqlite3'); const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  try {
    let state = await openSqliteInactiveClientState(database, migration, verifier)
    state.enroll(identity, 'keychain:device.owner')
    await state.registerWorkspace({ handle: 'workspace:project', root: workspace, access: 'read', grantId: 'grant.workspace', expiresAt: later })
    state.saveExecutorReport({ schemaVersion: 1, deviceId: identity.deviceId, executorId: 'claude-code', availability: 'ready', version: '2.1.177', protocolVersions: ['envelope.v1'], capabilities: ['agent.execute'], constraints: ['local-only'], discoveredAt: at.toISOString(), expiresAt: later })
    state.saveInactiveCapability({ capabilityId: 'tool.demo', version: '1.0.0', artifactDigest: sha, deviceId: identity.deviceId, installation: 'installed', loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled', updatedAt: at.toISOString() })
    const journal = new InactiveLocalRunJournalV1(verifier); const accepted = await journal.acceptLease(lease(), 'claude-code', at); journal.markLeaseAcknowledged(accepted.taskId, at); journal.begin(accepted.taskId, at); const completed = journal.completePendingSync(accepted.taskId, { outcome: 'succeeded', summaryCode: 'fixture.complete', artifactDigests: [sha] }, at)
    await state.saveRunCheckpoint(completed, at)
    const projection = state.cloudProjection(at); const encoded = JSON.stringify(projection)
    assert.deepEqual({ workspaces: projection.workspaceHandleCount, installed: projection.installedCapabilityCount, active: projection.activeCapabilityCount, pending: projection.pendingResultCount }, { workspaces: 1, installed: 1, active: 0, pending: 1 })
    assert.equal(encoded.includes(workspace), false); assert.equal(encoded.includes('keychain:'), false); assert.equal(projection.executorReports[0]?.availability, 'ready')
    assert.deepEqual({ reports: state.cloudProjection(new Date(later)).executorReports.length, workspaces: state.cloudProjection(new Date(later)).workspaceHandleCount }, { reports: 0, workspaces: 0 })
    await state.close()

    state = await openSqliteInactiveClientState(database, migration, verifier)
    assert.equal((await state.resolveWorkspace('workspace:project', at)).canonicalRoot, await realpath(workspace))
    assert.equal((await state.restoreRunJournal(at)).resultForSync('task.one').summaryCode, 'fixture.complete')
    assert.deepEqual(state.cloudProjection(at), projection)
    const outside = join(directory, 'outside'); await mkdir(outside); await rm(workspace, { recursive: true }); await symlink(outside, workspace)
    await assert.rejects(() => state.resolveWorkspace('workspace:project', at), /identity changed/)
    await state.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rejects enrollment drift, foreign reports, active capabilities and checkpoint rollback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-state-')); const database = join(directory, 'client.sqlite3')
  try {
    const state = await openSqliteInactiveClientState(database, migration, verifier); state.enroll(identity, 'secret:device.owner')
    assert.throws(() => state.enroll({ ...identity, deviceId: 'device.other' }, 'secret:device.owner'), /immutable/)
    assert.throws(() => state.saveExecutorReport({ schemaVersion: 1, deviceId: 'device.other', executorId: 'codex', availability: 'not-installed', version: null, protocolVersions: [], capabilities: [], constraints: [], discoveredAt: at.toISOString(), expiresAt: later }), /another device/)
    assert.throws(() => state.saveInactiveCapability({ capabilityId: 'tool.demo', version: '1.0.0', artifactDigest: sha, deviceId: identity.deviceId, installation: 'installed', loading: 'loaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled', updatedAt: at.toISOString() }), /installed-inactive/)
    const journal = new InactiveLocalRunJournalV1(verifier); const checkpoint = await journal.acceptLease(lease(), 'claude-code', at); await state.saveRunCheckpoint(checkpoint, at)
    await assert.rejects(() => state.saveRunCheckpoint({ ...checkpoint, checkpointDigest: `sha256:${'b'.repeat(64)}` }, at), /integrity/)
    await state.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('persists scoped no-Dida Matters idempotently without an executable action or cloud content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-client-matter-')); const database = join(directory, 'client.sqlite3')
  const input = { tenantId: identity.tenantId, userId: identity.userId, sourceId: 'om-sensitive-source', idempotencyKey: 'intake:om-sensitive-source:1', title: 'Private task title', summary: 'Private task summary', priority: 3 as const, tags: ['product'] }
  try {
    let state = await openSqliteInactiveClientState(database, migration, verifier)
    state.enroll(identity, 'secret:device.owner')
    const first = state.upsertIntakeMatter(input, at)
    assert.equal(first.inserted, true)
    assert.equal(first.matter.status, 'open')
    assert.equal(first.matter.title, input.title)
    assert.equal(state.upsertIntakeMatter(input, at).inserted, false)
    assert.throws(() => state.upsertIntakeMatter({ ...input, title: 'Changed with same key' }, at), /different durable content/)
    assert.throws(() => state.upsertIntakeMatter({ ...input, userId: 'user.other' }, at), /scope/)
    assert.throws(() => state.intakeMatter(identity.tenantId, 'user.other', first.matter.matterId), /scope/)
    assert.throws(() => state.upsertIntakeMatter({ ...input, existingMatterId: first.matter.matterId }, at), /separate reconciliation/)
    const updated = state.upsertIntakeMatter({ ...input, idempotencyKey: 'intake:om-sensitive-source:2', summary: 'Revised locally' }, new Date(later))
    assert.equal(updated.inserted, false)
    assert.equal(updated.changed, true)
    assert.equal(updated.matter.matterId, first.matter.matterId)
    const projection = JSON.stringify(state.cloudProjection(at))
    assert.equal(projection.includes(input.title) || projection.includes(input.summary) || projection.includes(input.sourceId), false)
    await state.close()

    const db = new DatabaseSync(database)
    const lineage = db.prepare('SELECT source_fingerprint, idempotency_fingerprint FROM local_matter JOIN local_matter_intake USING (tenant_id,user_id,matter_id) LIMIT 1').get() as { source_fingerprint: string; idempotency_fingerprint: string }
    assert.match(lineage.source_fingerprint, /^[a-f0-9]{64}$/)
    assert.match(lineage.idempotency_fingerprint, /^[a-f0-9]{64}$/)
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='action_execution'").get(), undefined)
    db.prepare("UPDATE local_matter SET status='completed' WHERE matter_id=?").run(first.matter.matterId)
    db.close()

    state = await openSqliteInactiveClientState(database, migration, verifier)
    assert.equal(state.intakeMatter(identity.tenantId, identity.userId, first.matter.matterId)?.status, 'completed')
    assert.throws(() => state.upsertIntakeMatter({ ...input, idempotencyKey: 'intake:om-sensitive-source:3' }, at), /terminal Matter/)
    await state.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
