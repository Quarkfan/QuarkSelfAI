import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { AgentDraftRecordV1, AgentTestReleaseV1, PersistentAgentStudioPortV1, TenantContextV1 } from './contracts.js'
import type { TenantAuthorizationPortV1, TenantControlActionV1 } from './tenant-persistence.js'
import { validateInactiveAgentBlueprint } from './test-agent-studio.js'

type Row = Record<string, string | number>
const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/

/** Persistent, tenant-scoped Agent Studio provider. It owns no listener, scheduler, dispatcher, executor, or runtime mount. */
export class SqliteInactiveAgentStudioV1 implements PersistentAgentStudioPortV1 {
  constructor(private readonly database: DatabaseSync, private readonly authorization: TenantAuthorizationPortV1) {}

  async saveDraft(context: TenantContextV1, input: { readonly draftId: string; readonly blueprint: Parameters<typeof validateInactiveAgentBlueprint>[0]; readonly expectedRevision: number }, now = new Date()): Promise<AgentDraftRecordV1> {
    validateContext(context)
    validId(input.draftId, 'draftId')
    validRevision(input.expectedRevision)
    await this.#authorize(context, 'agent-draft.write', `agent-draft:${input.draftId}`)
    const blueprint = validateInactiveAgentBlueprint(input.blueprint)
    const existing = this.#draft(context, input.draftId)
    const actualRevision = existing?.revision ?? 0
    if (input.expectedRevision !== actualRevision) throw new Error(`draft revision conflict: expected ${input.expectedRevision}, actual ${actualRevision}`)
    const timestamp = validNow(now)
    const next = {
      tenantId: context.tenantId, userId: context.userId, draftId: input.draftId, blueprint,
      revision: actualRevision + 1, state: 'draft' as const, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
    }
    const changed = this.database.prepare(`INSERT INTO cp_agent_draft
      (tenant_id, user_id, draft_id, blueprint_json, blueprint_digest, revision, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      ON CONFLICT (tenant_id, user_id, draft_id) DO UPDATE SET
        blueprint_json = excluded.blueprint_json, blueprint_digest = excluded.blueprint_digest,
        revision = excluded.revision, state = 'draft', updated_at = excluded.updated_at
      WHERE cp_agent_draft.revision = ?`).run(
        context.tenantId, context.userId, input.draftId, JSON.stringify(blueprint), blueprint.digest,
        next.revision, next.createdAt, next.updatedAt, input.expectedRevision,
      )
    if (Number(changed.changes) !== 1) throw new Error('draft revision changed concurrently')
    return freezeDraft(next)
  }

  async publishTest(context: TenantContextV1, input: { readonly draftId: string; readonly expectedRevision: number }, now = new Date()): Promise<AgentTestReleaseV1> {
    validateContext(context)
    validId(input.draftId, 'draftId')
    validRevision(input.expectedRevision)
    await this.#authorize(context, 'agent-release.publish-test', `agent-draft:${input.draftId}`)
    const draft = this.#draft(context, input.draftId)
    if (!draft) throw new Error('agent draft is unavailable')
    if (draft.revision !== input.expectedRevision) throw new Error(`draft revision conflict: expected ${input.expectedRevision}, actual ${draft.revision}`)
    const existing = this.#release(context, draft.blueprint.id, draft.blueprint.version)
    if (existing && existing.blueprintDigest !== draft.blueprint.digest) throw new Error('immutable test release already exists with another digest')
    if (existing) {
      const changed = this.database.prepare(`UPDATE cp_agent_draft SET state = 'test-released', updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND draft_id = ? AND revision = ?`).run(
          validNow(now), context.tenantId, context.userId, input.draftId, input.expectedRevision,
        )
      if (Number(changed.changes) !== 1) throw new Error('draft revision changed concurrently')
      return existing
    }
    const release = freezeRelease({
      tenantId: context.tenantId, userId: context.userId, draftId: draft.draftId,
      blueprintId: draft.blueprint.id, version: draft.blueprint.version, blueprintDigest: draft.blueprint.digest,
      draftRevision: draft.revision, state: 'test' as const, createdAt: validNow(now),
    })
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`INSERT INTO cp_agent_test_release
        (tenant_id, user_id, blueprint_id, version, draft_id, blueprint_digest, draft_revision, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          release.tenantId, release.userId, release.blueprintId, release.version, release.draftId,
          release.blueprintDigest, release.draftRevision, release.createdAt,
        )
      const changed = this.database.prepare(`UPDATE cp_agent_draft SET state = 'test-released', updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND draft_id = ? AND revision = ?`).run(
          release.createdAt, context.tenantId, context.userId, input.draftId, input.expectedRevision,
        )
      if (Number(changed.changes) !== 1) throw new Error('draft revision changed concurrently')
      this.database.exec('COMMIT')
      return release
    } catch (error) {
      this.database.exec('ROLLBACK')
      const concurrent = this.#release(context, draft.blueprint.id, draft.blueprint.version)
      if (concurrent?.blueprintDigest === draft.blueprint.digest) return concurrent
      throw error
    }
  }

  async getDraft(context: TenantContextV1, draftId: string): Promise<AgentDraftRecordV1 | undefined> {
    validateContext(context)
    validId(draftId, 'draftId')
    await this.#authorize(context, 'agent-draft.read', `agent-draft:${draftId}`)
    return this.#draft(context, draftId)
  }

  async listDrafts(context: TenantContextV1): Promise<readonly AgentDraftRecordV1[]> {
    validateContext(context)
    await this.#authorize(context, 'agent-draft.read', `agent-drafts:user:${context.userId}`)
    const rows = this.database.prepare(`SELECT * FROM cp_agent_draft
      WHERE tenant_id = ? AND user_id = ? ORDER BY updated_at DESC, draft_id`).all(context.tenantId, context.userId) as unknown as Row[]
    return Object.freeze(rows.map(draftFromRow))
  }

  async close(): Promise<void> { this.database.close() }

  #draft(context: TenantContextV1, draftId: string): AgentDraftRecordV1 | undefined {
    const row = this.database.prepare(`SELECT * FROM cp_agent_draft
      WHERE tenant_id = ? AND user_id = ? AND draft_id = ?`).get(context.tenantId, context.userId, draftId) as Row | undefined
    return row ? draftFromRow(row) : undefined
  }

  #release(context: TenantContextV1, blueprintId: string, version: string): AgentTestReleaseV1 | undefined {
    const row = this.database.prepare(`SELECT * FROM cp_agent_test_release
      WHERE tenant_id = ? AND user_id = ? AND blueprint_id = ? AND version = ?`).get(context.tenantId, context.userId, blueprintId, version) as Row | undefined
    return row ? releaseFromRow(row) : undefined
  }

  async #authorize(context: TenantContextV1, action: TenantControlActionV1, subjectRef: string): Promise<void> {
    if (!await this.authorization.authorize({ context, action, subjectRef })) throw new Error('Agent Studio operation is not authorized')
  }
}

export async function openSqliteInactiveAgentStudio(
  databasePath: string,
  migrationPaths: readonly string[],
  authorization: TenantAuthorizationPortV1,
): Promise<SqliteInactiveAgentStudioV1> {
  const path = resolve(databasePath)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(path)
  try {
    for (const migrationPath of migrationPaths) database.exec(await readFile(resolve(migrationPath), 'utf8'))
    return new SqliteInactiveAgentStudioV1(database, authorization)
  } catch (error) { database.close(); throw error }
}

function draftFromRow(row: Row): AgentDraftRecordV1 {
  const blueprint = validateInactiveAgentBlueprint(JSON.parse(String(row.blueprint_json)))
  if (blueprint.digest !== row.blueprint_digest) throw new Error('persisted blueprint digest is invalid')
  return freezeDraft({ tenantId: String(row.tenant_id), userId: String(row.user_id), draftId: String(row.draft_id), blueprint,
    revision: Number(row.revision), state: String(row.state) as AgentDraftRecordV1['state'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
}

function releaseFromRow(row: Row): AgentTestReleaseV1 {
  if (!digestPattern.test(String(row.blueprint_digest))) throw new Error('persisted release digest is invalid')
  return freezeRelease({ tenantId: String(row.tenant_id), userId: String(row.user_id), draftId: String(row.draft_id),
    blueprintId: String(row.blueprint_id), version: String(row.version), blueprintDigest: String(row.blueprint_digest),
    draftRevision: Number(row.draft_revision), state: 'test', createdAt: String(row.created_at) })
}

function validateContext(context: TenantContextV1): void {
  validId(context.tenantId, 'tenantId'); validId(context.userId, 'userId')
  if (!context.tenantId.startsWith('test.') || !context.roles.length || new Set(context.roles).size !== context.roles.length || context.roles.some(role => !['owner', 'member', 'auditor'].includes(role))) throw new Error('inactive Agent Studio accepts scoped test tenants only')
}
function validId(value: string, label: string): void { if (!idPattern.test(value)) throw new Error(`${label} is invalid`) }
function validRevision(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new Error('expectedRevision must be a non-negative integer') }
function validNow(now: Date): string { if (Number.isNaN(now.getTime())) throw new Error('timestamp is invalid'); return now.toISOString() }
function freezeDraft(value: AgentDraftRecordV1): AgentDraftRecordV1 { return deepFreeze(structuredClone(value)) }
function freezeRelease(value: AgentTestReleaseV1): AgentTestReleaseV1 { return Object.freeze({ ...value }) }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }
