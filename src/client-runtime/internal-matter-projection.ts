import { requireAuthorizationEvidence, type DurableAuthorizationEvidence } from '../domain/authorization.js'
import { validateNormalizedChannelEvent, type NormalizedChannelEvent } from '../domain/channel.js'
import { validateIntakeDecision } from '../intake/types.js'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import { TASK_PROJECTION_EFFECTS } from '../task-system/projection-effects.js'
import type { LocalMatterProjectionPortV1 } from './local-client-application.js'
import type { LocalIntakeMatterV1 } from './sqlite-client-state.js'

const SCOPE = 'client.internal-matter.intake'

export interface InternalMatterIntakeGrantV1 extends DurableAuthorizationEvidence {
  readonly tenantId: string
  readonly userId: string
}

/** Must read trusted, current Client authorization state on every invocation. No default implementation exists. */
export interface CurrentMatterAuthorizationPortV1 {
  isActive(grant: InternalMatterIntakeGrantV1, context: { readonly sourceId: string; readonly effectiveAt: string }): Promise<boolean>
}

/** Deliberately unregistered: this is not a DSH provider or a second Client writer. */
export class InactiveInternalMatterProjectionV1 {
  constructor(private readonly matter: LocalMatterProjectionPortV1, private readonly authorization: CurrentMatterAuthorizationPortV1) {}

  async project(effect: ClaimedWorkflowEffect): Promise<{ readonly matter: LocalIntakeMatterV1; readonly action: 'created' | 'updated' | 'unchanged' }> {
    if (effect.kind !== TASK_PROJECTION_EFFECTS.upsertIntake) throw new Error('unsupported internal Matter effect')
    const payload = effect.payload
    if (payload.projectId !== undefined) throw new Error('Dida projection target cannot write internal Matter')
    record(payload.sourceEvent, 'source event')
    const event = payload.sourceEvent as NormalizedChannelEvent
    validateNormalizedChannelEvent(event)
    if (event.kind !== 'message.received' || event.source.channel !== 'feishu') throw new Error('internal Matter intake requires a Feishu message')
    const sourceId = required(event.source.resourceId ?? event.deduplicationKey, 'source ID', 500)
    const key = required(payload.idempotencyKey, 'idempotency key', 1_000)
    if (key !== `feishu:${sourceId}`) throw new Error('internal Matter idempotency key does not match source')
    const effectiveAt = required(payload.effectiveAt, 'effectiveAt', 100)
    if (Number.isNaN(Date.parse(effectiveAt))) throw new Error('internal Matter effectiveAt is invalid')
    const decision = validateIntakeDecision(payload.decision)
    if (decision.outcome !== 'task') throw new Error('internal Matter projection requires a task decision')
    if (decision.existingTaskId !== undefined) throw new Error('old task reconciliation is not internal Matter intake')
    const grantInput = record(payload.authorization, 'internal Matter authorization')
    const evidence = requireAuthorizationEvidence(grantInput, { scope: SCOPE, grantedBy: 'owner' }, effectiveAt)
    const tenantId = required(grantInput.tenantId, 'authorization tenantId', 128)
    const userId = required(grantInput.userId, 'authorization userId', 128)
    const grant: InternalMatterIntakeGrantV1 = { ...evidence, tenantId, userId }
    if (!await this.authorization.isActive(grant, { sourceId, effectiveAt })) throw new Error('internal Matter authorization is not active')
    const receipt = this.matter.upsertIntake({
      tenantId, userId, sourceId, idempotencyKey: key, title: decision.title!, summary: decision.summary,
      priority: decision.priority as 1 | 3 | 5, tags: decision.tags!,
      ...(decision.dueDate ? { dueAt: decision.dueDate } : {}),
    }, new Date(effectiveAt))
    const readback = this.matter.get(tenantId, userId, receipt.matter.matterId)
    if (!readback || readback.matterId !== receipt.matter.matterId) throw new Error('internal Matter write has no readback')
    return { matter: readback, action: receipt.inserted ? 'created' : receipt.changed ? 'updated' : 'unchanged' }
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is required`)
  return value as Record<string, unknown>
}
function required(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is invalid`)
  return value
}
