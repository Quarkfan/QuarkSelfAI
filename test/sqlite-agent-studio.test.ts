import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defineAgentBlueprint } from '../src/capability-sdk/index.js'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'
import { openSqliteInactiveAgentStudio } from '../src/control-plane/sqlite-agent-studio.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

const identityMigration = new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname
const studioMigration = new URL('../migrations/control-plane-sqlite/002_agent_studio.sql', import.meta.url).pathname
const at = new Date('2026-09-06T00:00:00.000Z')
const later = new Date('2026-09-06T00:01:00.000Z')
const alpha: TenantContextV1 = { tenantId: 'test.alpha', userId: 'owner', roles: ['owner'] }
const beta: TenantContextV1 = { tenantId: 'test.beta', userId: 'owner', roles: ['owner'] }

function blueprint(goals: readonly string[] = ['Complete task']) {
  return defineAgentBlueprint({
    schemaVersion: 1, id: 'agent/example', name: 'Example Agent', version: '1.0.0', revision: 'draft-1', releaseState: 'test', role: 'worker', goals,
    capabilities: [], graph: { nodes: [], edges: [] }, triggers: [{ id: 'manual', kind: 'manual', specification: 'console', enabled: true }],
    executorPolicy: { preferred: ['claude-code'], fallback: ['codex', 'dsh'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
    deviceSelector: 'device:owner', workspaceHandles: [], permissions: [], modelPolicy: { allowed: ['provider-neutral'], preferred: null },
    budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 10 }, retry: { infrastructureAttempts: 2, deterministicAttempts: 1 },
    notifications: { channels: ['console'], on: ['completion'] }, retention: { localRawDays: 1, cloudSummaryDays: 7 },
  })
}

async function provision(database: string): Promise<void> {
  const repository = await openSqliteTenantControlRepository(database, identityMigration)
  const service = new TenantControlServiceV1(repository, { authorize: async () => true })
  for (const context of [alpha, beta]) {
    await service.createTenant(context, { name: context.tenantId }, at)
    await service.registerUser(context, { userId: context.userId, displayName: 'Owner' }, at)
  }
  await repository.close()
}

test('persists tenant-isolated drafts and immutable test releases across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-studio-'))
  const database = join(directory, 'control-plane.sqlite3')
  const actions: string[] = []
  const authorization = { authorize: async ({ action }: { action: string }) => { actions.push(action); return true } }
  try {
    await provision(database)
    let studio = await openSqliteInactiveAgentStudio(database, [identityMigration, studioMigration], authorization)
    const first = await studio.saveDraft(alpha, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 }, at)
    await studio.saveDraft(beta, { draftId: 'draft.one', blueprint: blueprint(['Different tenant']), expectedRevision: 0 }, at)
    await assert.rejects(() => studio.saveDraft(alpha, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 }, at), /revision conflict/)
    const release = await studio.publishTest(alpha, { draftId: first.draftId, expectedRevision: first.revision }, later)
    assert.equal(release.blueprintDigest, first.blueprint.digest)
    assert.equal((await studio.getDraft(alpha, first.draftId))?.state, 'test-released')
    assert.equal((await studio.getDraft(beta, first.draftId))?.blueprint.goals[0], 'Different tenant')
    await studio.close()

    studio = await openSqliteInactiveAgentStudio(database, [identityMigration, studioMigration], authorization)
    assert.deepEqual((await studio.listDrafts(alpha)).map(item => [item.draftId, item.revision, item.state]), [['draft.one', 1, 'test-released']])
    assert.deepEqual(await studio.publishTest(alpha, { draftId: first.draftId, expectedRevision: first.revision }, later), release)
    assert.ok(actions.includes('agent-draft.write') && actions.includes('agent-draft.read') && actions.includes('agent-release.publish-test'))
    await studio.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('fails closed before reading or writing when Agent Studio authorization is denied', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-studio-'))
  const database = join(directory, 'control-plane.sqlite3')
  try {
    await provision(database)
    const studio = await openSqliteInactiveAgentStudio(database, [identityMigration, studioMigration], { authorize: async () => false })
    await assert.rejects(() => studio.saveDraft(alpha, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 }, at), /not authorized/)
    await assert.rejects(() => studio.listDrafts(alpha), /not authorized/)
    await assert.rejects(() => studio.saveDraft({ ...alpha, tenantId: 'prod.alpha' }, { draftId: 'draft.one', blueprint: blueprint(), expectedRevision: 0 }, at), /test tenants/)
    await studio.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
