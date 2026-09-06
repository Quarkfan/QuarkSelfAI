import { blueprintPayloadDigest, validateAgentBlueprint } from '../capability-platform/validation.js'
import type { AgentDraftRecordV1, AgentTestReleaseV1, TenantContextV1, TestAgentStudioPortV1 } from './contracts.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const unsafeValue = /(?:^|["'])\/(?:Users|home|private|var|etc)(?:\/|["'])|[A-Za-z]:[\\/]|(?:token|secret|password|private[_-]?key)\s*[:=]/i

/** Tenant-scoped Agent Studio model. It has no HTTP listener, persistence adapter, scheduler, dispatcher or runtime mount. */
export class InactiveTestAgentStudioV1 implements TestAgentStudioPortV1 {
  readonly #drafts = new Map<string, AgentDraftRecordV1>()
  readonly #releases = new Map<string, AgentTestReleaseV1>()

  saveDraft(context: TenantContextV1, input: { readonly draftId: string; readonly blueprint: Parameters<typeof validateAgentBlueprint>[0]; readonly expectedRevision: number }, now = new Date()): AgentDraftRecordV1 {
    this.#context(context)
    if (!idPattern.test(input.draftId)) throw new Error('draftId is invalid')
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('expectedRevision must be a non-negative integer')
    const blueprint = validateInactiveAgentBlueprint(input.blueprint)
    const key = this.#draftKey(context, input.draftId)
    const existing = this.#drafts.get(key)
    const actualRevision = existing?.revision ?? 0
    if (input.expectedRevision !== actualRevision) throw new Error(`draft revision conflict: expected ${input.expectedRevision}, actual ${actualRevision}`)
    const at = now.toISOString()
    const record = deepFreeze({
      tenantId: context.tenantId,
      userId: context.userId,
      draftId: input.draftId,
      blueprint: structuredClone(blueprint),
      revision: actualRevision + 1,
      state: 'draft' as const,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    })
    this.#drafts.set(key, record)
    return record
  }

  publishTest(context: TenantContextV1, input: { readonly draftId: string; readonly expectedRevision: number }, now = new Date()): AgentTestReleaseV1 {
    this.#context(context)
    const key = this.#draftKey(context, input.draftId)
    const draft = this.#drafts.get(key)
    if (!draft) throw new Error('agent draft is unavailable')
    if (draft.revision !== input.expectedRevision) throw new Error(`draft revision conflict: expected ${input.expectedRevision}, actual ${draft.revision}`)
    const releaseKey = `${context.tenantId}\0${context.userId}\0${draft.blueprint.id}\0${draft.blueprint.version}`
    const existing = this.#releases.get(releaseKey)
    if (existing && existing.blueprintDigest !== draft.blueprint.digest) throw new Error('immutable test release already exists with another digest')
    if (existing) {
      this.#drafts.set(key, deepFreeze({ ...draft, state: 'test-released' as const, updatedAt: now.toISOString() }))
      return existing
    }
    const release = Object.freeze({
      tenantId: context.tenantId,
      userId: context.userId,
      draftId: draft.draftId,
      blueprintId: draft.blueprint.id,
      version: draft.blueprint.version,
      blueprintDigest: draft.blueprint.digest,
      draftRevision: draft.revision,
      state: 'test' as const,
      createdAt: now.toISOString(),
    })
    this.#releases.set(releaseKey, release)
    this.#drafts.set(key, deepFreeze({ ...draft, state: 'test-released' as const, updatedAt: now.toISOString() }))
    return release
  }

  getDraft(context: TenantContextV1, draftId: string): AgentDraftRecordV1 | undefined {
    this.#context(context)
    return this.#drafts.get(this.#draftKey(context, draftId))
  }

  listDrafts(context: TenantContextV1): readonly AgentDraftRecordV1[] {
    this.#context(context)
    const prefix = `${context.tenantId}\0${context.userId}\0`
    return [...this.#drafts.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value)
  }

  #context(context: TenantContextV1): void {
    if (!context.tenantId.startsWith('test.') || !idPattern.test(context.tenantId) || !idPattern.test(context.userId)) throw new Error('inactive Agent Studio accepts scoped test tenants only')
  }

  #draftKey(context: TenantContextV1, draftId: string): string {
    return `${context.tenantId}\0${context.userId}\0${draftId}`
  }
}

export function validateInactiveAgentBlueprint(input: Parameters<typeof validateAgentBlueprint>[0]) {
  const blueprint = validateAgentBlueprint(input)
  if (blueprint.digest !== blueprintPayloadDigest(blueprint)) throw new Error('blueprint digest does not match its canonical payload')
  if (blueprint.releaseState !== 'test') throw new Error('inactive Agent Studio accepts test blueprints only')
  if (blueprint.permissions.some(permission => permission.kind === 'external-effect' || permission.effect?.externalWrite)) throw new Error('inactive Agent Studio rejects external effects')
  if (blueprint.triggers.some(trigger => trigger.enabled && trigger.kind !== 'manual')) throw new Error('inactive Agent Studio rejects enabled automatic triggers')
  if (unsafeValue.test(JSON.stringify(blueprint))) throw new Error('blueprint contains host-local or secret-shaped values')
  return blueprint
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
