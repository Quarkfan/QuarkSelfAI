import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { InactiveInternalMatterProjectionV1 } from '../src/client-runtime/internal-matter-projection.js'
import { InactiveLocalClientApplicationV1 } from '../src/client-runtime/local-client-application.js'
import { openSqliteInactiveClientState } from '../src/client-runtime/sqlite-client-state.js'
import type { ClaimedWorkflowEffect } from '../src/storage/types.js'
import { TASK_PROJECTION_EFFECTS } from '../src/task-system/projection-effects.js'

const at = '2026-10-12T00:00:00.000Z'
const migrationPath = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const verifier = { verify: async () => true }
const identity = { schemaVersion: 1 as const, tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', publicKey: 'public.opaque', keyAlgorithm: 'ed25519' as const, createdAt: at, attestation: { kind: 'self' as const, reference: 'attestation.opaque' } }
const event = { kind: 'message.received', source: { channel: 'feishu', resourceId: 'om-one' }, eventKey: 'im.message.receive_v1', deduplicationKey: 'om-one', occurredAt: at, payload: {}, raw: {} }
const decision = { outcome: 'task', title: 'Review specification', summary: 'Owner needs to review', priority: 3, tags: ['product'], materialChange: true, notifyOwner: false, approvalRequired: false }
const grant = { id: 'grant.one', grantedBy: 'owner', grantedAt: at, scope: 'client.internal-matter.intake', revision: 1, source: 'local-owner-approval', tenantId: identity.tenantId, userId: identity.userId }
const effect: ClaimedWorkflowEffect = { id: 'effect.one', instanceId: 'intake.one', kind: TASK_PROJECTION_EFFECTS.upsertIntake, attempt: 1, payload: { sourceEvent: event, decision, authorization: grant, effectiveAt: at, idempotencyKey: 'feishu:om-one' } }

test('offline Feishu projection writes through one leased Client port, replays idempotently, and survives restart without Dida', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-internal-matter-projection-'))
  const paths = { databasePath: join(directory, 'client.sqlite3'), migrationPath, artifactRoot: join(directory, 'artifacts'), instanceLeasePath: join(directory, 'runtime', 'owner.lock') }
  try {
    const state = await openSqliteInactiveClientState(paths.databasePath, migrationPath, verifier)
    state.enroll(identity, 'secret:device.owner'); await state.close()
    let app = await InactiveLocalClientApplicationV1.open(paths, verifier, new Date(at))
    const authorization = { isActive: async () => true }
    const projection = new InactiveInternalMatterProjectionV1(app.matterPort(), authorization)
    const created = await projection.project(effect)
    assert.equal(created.action, 'created')
    assert.equal(created.matter.title, decision.title)
    assert.equal((await projection.project(effect)).action, 'unchanged')
    await assert.rejects(() => projection.project({ ...effect, payload: { ...effect.payload, decision: { ...decision, summary: 'Changed with same key' } } }), /different durable content/)
    await assert.rejects(() => projection.project({ ...effect, payload: { ...effect.payload, authorization: { ...grant, tenantId: 'tenant.other' } } }), /scope/)
    await assert.rejects(() => InactiveLocalClientApplicationV1.open(paths, verifier, new Date(at)), /another local client instance/)
    assert.equal(JSON.stringify(app.snapshot(new Date(at))).includes(decision.summary), false)
    await app.close()
    await assert.rejects(() => projection.project(effect), /closed/)
    app = await InactiveLocalClientApplicationV1.open(paths, verifier, new Date(at))
    const recovered = await new InactiveInternalMatterProjectionV1(app.matterPort(), authorization).project(effect)
    assert.equal(recovered.action, 'unchanged')
    assert.equal(recovered.matter.matterId, created.matter.matterId)
    await app.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('offline projection fails closed before write for absent/currently revoked grant and incompatible effect shape', async () => {
  let writes = 0
  const matter = { upsertIntake: () => { writes++; throw new Error('unexpected write') }, get: () => null }
  const rejected = new InactiveInternalMatterProjectionV1(matter, { isActive: async () => false })
  await assert.rejects(() => rejected.project(effect), /not active/)
  await assert.rejects(() => rejected.project({ ...effect, payload: { ...effect.payload, authorization: undefined } }), /authorization/)
  await assert.rejects(() => rejected.project({ ...effect, payload: { ...effect.payload, projectId: 'dida.project' } }), /Dida projection target/)
  await assert.rejects(() => rejected.project({ ...effect, payload: { ...effect.payload, decision: { ...decision, existingTaskId: 'dida.task' } } }), /reconciliation/)
  await assert.rejects(() => rejected.project({ ...effect, payload: { ...effect.payload, authorization: { ...grant, tenantId: 'tenant.other' } } }), /not active/)
  await assert.rejects(() => rejected.project({ ...effect, payload: { ...effect.payload, idempotencyKey: 'different' } }), /does not match source/)
  assert.equal(writes, 0)
})
