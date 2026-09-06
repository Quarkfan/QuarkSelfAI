import { contentDigest } from '../capability-platform/validation.js'
import type { PlanSignatureVerifierV1, SignedExecutionPlanV1 } from '../client-runtime/contracts.js'
import { verifySignedExecutionPlan } from '../client-runtime/validation.js'

export interface ShadowEffectAttemptV1 {
  readonly effectKind: string
  readonly scope: string
  readonly inputDigest: string
  readonly idempotencyKey: string
}

export interface ShadowEffectRecordV1 {
  readonly schemaVersion: 1
  readonly recordId: string
  readonly planId: string
  readonly actionId: string
  readonly effectKind: string
  readonly scopeDigest: string
  readonly inputDigest: string
  readonly idempotencyKey: string
  readonly state: 'recorded-not-executed'
  readonly effectExecuted: false
  readonly recordedAt: string
}

export interface ShadowEffectSnapshotV1 {
  readonly schemaVersion: 1
  readonly planId: string
  readonly mode: 'recording-sink'
  readonly recordCount: number
  readonly recordIds: readonly string[]
  readonly effectExecuted: false
}

/** Verified-plan sink with no effect callback or provider dependency by design. */
export class ShadowEffectRecordingSinkV1 {
  readonly #records = new Map<string, ShadowEffectRecordV1>()

  private constructor(private readonly plan: SignedExecutionPlanV1) {}

  static async open(plan: SignedExecutionPlanV1, verifier: PlanSignatureVerifierV1, now: Date): Promise<ShadowEffectRecordingSinkV1> {
    await verifySignedExecutionPlan(plan, verifier, now)
    return new ShadowEffectRecordingSinkV1(plan)
  }

  record(attempt: ShadowEffectAttemptV1, now: Date): ShadowEffectRecordV1 {
    if (!/^sha256:[a-f0-9]{64}$/.test(attempt.inputDigest)) throw new Error('shadow effect input digest is invalid')
    if (!attempt.effectKind.trim() || !attempt.scope.trim() || !attempt.idempotencyKey.trim()) throw new Error('shadow effect attempt is incomplete')
    if (!this.plan.envelope.allowedEffects.includes(attempt.effectKind)) throw new Error('effect is outside the signed plan')
    const grant = this.plan.envelope.approvalGrants.find(candidate =>
      candidate.tenantId === this.plan.envelope.tenantId
      && candidate.userId === this.plan.envelope.userId
      && candidate.deviceId === this.plan.envelope.deviceId
      && candidate.agentId === this.plan.envelope.agentId
      && candidate.actionId === this.plan.envelope.actionId
      && candidate.effectKind === attempt.effectKind
      && candidate.scope === attempt.scope
      && Date.parse(candidate.expiresAt) > now.getTime(),
    )
    if (!grant) throw new Error('shadow effect requires an exact active approval grant')
    const scopeDigest = contentDigest(attempt.scope)
    const recordId = contentDigest({ planId: this.plan.planId, actionId: this.plan.envelope.actionId, effectKind: attempt.effectKind, scope: attempt.scope, inputDigest: attempt.inputDigest, idempotencyKey: attempt.idempotencyKey })
    const existing = this.#records.get(recordId)
    if (existing) return existing
    if (grant.singleUse && [...this.#records.values()].some(record => record.effectKind === attempt.effectKind && record.scopeDigest === scopeDigest)) throw new Error('single-use approval is already represented by another effect attempt')
    const record = Object.freeze({
      schemaVersion: 1 as const,
      recordId,
      planId: this.plan.planId,
      actionId: this.plan.envelope.actionId,
      effectKind: attempt.effectKind,
      scopeDigest,
      inputDigest: attempt.inputDigest,
      idempotencyKey: attempt.idempotencyKey,
      state: 'recorded-not-executed' as const,
      effectExecuted: false as const,
      recordedAt: now.toISOString(),
    })
    this.#records.set(recordId, record)
    return record
  }

  snapshot(): ShadowEffectSnapshotV1 {
    return Object.freeze({ schemaVersion: 1, planId: this.plan.planId, mode: 'recording-sink', recordCount: this.#records.size, recordIds: Object.freeze([...this.#records.keys()].sort()), effectExecuted: false })
  }
}
