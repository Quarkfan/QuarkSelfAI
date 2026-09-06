import assert from 'node:assert/strict'
import test from 'node:test'
import { defineAgentBlueprint } from '../src/capability-sdk/index.js'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'
import { InactiveTestAgentStudioV1 } from '../src/control-plane/test-agent-studio.js'

const alpha: TenantContextV1 = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] }
const beta: TenantContextV1 = { tenantId: 'test.beta', userId: 'user.owner', roles: ['owner'] }

function blueprint(version = '1.0.0', overrides: Record<string, unknown> = {}) {
  return defineAgentBlueprint({
    schemaVersion: 1, id: 'agent/example', name: 'Example Agent', version, revision: `draft-${version}`, releaseState: 'test', role: 'worker', goals: ['Complete task'],
    capabilities: [], graph: { nodes: [], edges: [] }, triggers: [{ id: 'manual', kind: 'manual', specification: 'console', enabled: true }],
    executorPolicy: { preferred: ['claude-code'], fallback: ['codex', 'dsh'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
    deviceSelector: 'device:owner', workspaceHandles: [], permissions: [], modelPolicy: { allowed: ['provider-neutral'], preferred: null },
    budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 10 }, retry: { infrastructureAttempts: 2, deterministicAttempts: 1 },
    notifications: { channels: ['console'], on: ['completion'] }, retention: { localRawDays: 1, cloudSummaryDays: 7 }, ...overrides,
  } as never)
}

test('saves immutable tenant-scoped drafts with optimistic revisions', () => {
  const studio = new InactiveTestAgentStudioV1()
  const first = studio.saveDraft(alpha, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 })
  assert.equal(first.revision, 1)
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.blueprint))
  assert.throws(() => studio.saveDraft(alpha, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 }), /revision conflict/)
  assert.equal(studio.saveDraft(alpha, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 1 }).revision, 2)
  assert.equal(studio.getDraft(beta, 'draft.one'), undefined)
})

test('publishes one immutable test release without dispatching it', () => {
  const studio = new InactiveTestAgentStudioV1()
  const draft = studio.saveDraft(alpha, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 })
  const release = studio.publishTest(alpha, { draftId: draft.draftId, expectedRevision: draft.revision })
  assert.deepEqual({ state: release.state, digest: release.blueprintDigest }, { state: 'test', digest: draft.blueprint.digest })
  assert.equal(studio.publishTest(alpha, { draftId: draft.draftId, expectedRevision: draft.revision }), release)
  assert.equal(studio.getDraft(alpha, draft.draftId)?.state, 'test-released')

  const updated = studio.saveDraft(alpha, { draftId: draft.draftId, blueprint: blueprint('1.0.0', { goals: ['Different goal'] }), expectedRevision: draft.revision })
  assert.throws(() => studio.publishTest(alpha, { draftId: updated.draftId, expectedRevision: updated.revision }), /immutable test release/)
})

test('rejects production tenants, automatic triggers, effects, secrets and stale digests', () => {
  const studio = new InactiveTestAgentStudioV1()
  assert.throws(() => studio.saveDraft({ ...alpha, tenantId: 'tenant.prod' }, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 }), /test tenants/)
  assert.throws(() => studio.saveDraft(alpha, { draftId: 'draft.auto', blueprint: blueprint('1.0.0', { triggers: [{ id: 'timer', kind: 'schedule', specification: 'hourly', enabled: true }] }), expectedRevision: 0 }), /automatic triggers/)
  const permission = { id: 'effect.send', kind: 'external-effect', operations: ['write'], scope: 'message:owner', placement: 'cloud', approval: 'action', required: true, dataClasses: [], effect: { kind: 'message.send', externalWrite: true, writeVerificationRequired: true } }
  assert.throws(() => studio.saveDraft(alpha, { draftId: 'draft.effect', blueprint: blueprint('1.0.0', { permissions: [permission] }), expectedRevision: 0 }), /external effects/)
  assert.throws(() => studio.saveDraft(alpha, { draftId: 'draft.path', blueprint: blueprint('1.0.0', { deviceSelector: '/Users/example' }), expectedRevision: 0 }), /opaque|host-local/)
  const stale = { ...blueprint(), name: 'Changed after digest' }
  assert.throws(() => studio.saveDraft(alpha, { draftId: 'draft.stale', blueprint: stale, expectedRevision: 0 }), /digest/)
})
