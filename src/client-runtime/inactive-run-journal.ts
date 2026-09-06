import { contentDigest, toExecutorAdapterInput } from '../capability-platform/validation.js'
import type { DeviceTaskLeaseV1, PlanSignatureVerifierV1, SignedExecutionPlanV1 } from './contracts.js'
import { verifySignedExecutionPlan } from './validation.js'
import type { RedactedResultV1 } from '../control-plane/contracts.js'

export type InactiveLocalRunState = 'leased' | 'running' | 'paused' | 'completed-pending-sync' | 'synced' | 'cancelled'

export interface InactiveLocalRunCheckpointV1 {
  readonly schemaVersion: 1
  readonly taskId: string
  readonly deviceId: string
  readonly plan: SignedExecutionPlanV1
  readonly executorId: string
  readonly normalizedContextDigest: string
  readonly state: InactiveLocalRunState
  readonly revision: number
  readonly result: Omit<RedactedResultV1, 'tenantId' | 'userId'> | null
  readonly effectMode: 'recording-sink'
  readonly externalWritesEnabled: false
  readonly updatedAt: string
  readonly checkpointDigest: string
}

const unsafeText = /(?:^|[\\/])Users[\\/]|(?:token|secret|password|private[_-]?key)\s*[:=]/i

/** In-memory local state machine only; it has no executor, filesystem or network adapter. */
export class InactiveLocalRunJournalV1 {
  readonly #runs = new Map<string, InactiveLocalRunCheckpointV1>()

  constructor(private readonly verifier: PlanSignatureVerifierV1) {}

  async acceptLease(lease: DeviceTaskLeaseV1, executorId: string, now: Date): Promise<InactiveLocalRunCheckpointV1> {
    if (lease.schemaVersion !== 1 || lease.externalWritesEnabled !== false || !lease.taskId.trim()) throw new Error('local run lease is invalid')
    if (!lease.leaseToken || !Number.isSafeInteger(lease.attempt) || lease.attempt < 1 || Number.isNaN(Date.parse(lease.leasedAt)) || Date.parse(lease.expiresAt) <= now.getTime()) throw new Error('local run lease is expired or incomplete')
    if (lease.planId !== lease.plan.planId || lease.deviceId !== lease.plan.envelope.deviceId) throw new Error('local run lease scope does not match its plan')
    if (lease.plan.envelope.allowedEffects.length || lease.plan.envelope.approvalGrants.length) throw new Error('inactive local run accepts no-effect plans only')
    await verifySignedExecutionPlan(lease.plan, this.verifier, now)
    const adapter = toExecutorAdapterInput(executorId, lease.plan.envelope)
    const existing = this.#runs.get(lease.taskId)
    if (existing) {
      if (existing.plan.planId !== lease.planId || existing.deviceId !== lease.deviceId || existing.executorId !== executorId) throw new Error('local run task already belongs to another plan, device or executor')
      return existing
    }
    const checkpoint = seal({
      schemaVersion: 1 as const, taskId: lease.taskId, deviceId: lease.deviceId, plan: structuredClone(lease.plan), executorId,
      normalizedContextDigest: adapter.normalizedContextDigest, state: 'leased' as const, revision: 1, result: null,
      effectMode: 'recording-sink' as const, externalWritesEnabled: false as const, updatedAt: now.toISOString(),
    })
    this.#runs.set(lease.taskId, checkpoint)
    return checkpoint
  }

  begin(taskId: string, now: Date): InactiveLocalRunCheckpointV1 {
    const current = this.#run(taskId)
    if (current.state !== 'leased' && current.state !== 'paused') throw new Error('local run cannot begin from its current state')
    return this.#replace(current, { state: 'running', updatedAt: now.toISOString() })
  }

  pause(taskId: string, now: Date): InactiveLocalRunCheckpointV1 {
    const current = this.#run(taskId)
    if (current.state !== 'running') throw new Error('only a running local task can pause')
    return this.#replace(current, { state: 'paused', updatedAt: now.toISOString() })
  }

  completePendingSync(taskId: string, input: { outcome: 'succeeded' | 'failed' | 'cancelled'; summaryCode: string; artifactDigests: readonly string[] }, now: Date): InactiveLocalRunCheckpointV1 {
    const current = this.#run(taskId)
    if (current.state !== 'running') throw new Error('only a running local task can complete')
    if (!input.summaryCode || unsafeText.test(input.summaryCode) || !input.artifactDigests.every(value => /^sha256:[a-f0-9]{64}$/.test(value))) throw new Error('local result must be privacy bounded')
    const result = Object.freeze({ taskId, deviceId: current.deviceId, planId: current.plan.planId, outcome: input.outcome, summaryCode: input.summaryCode, artifactDigests: Object.freeze([...input.artifactDigests]), completedAt: now.toISOString() })
    return this.#replace(current, { state: 'completed-pending-sync', result, updatedAt: now.toISOString() })
  }

  markSynced(taskId: string, now: Date): InactiveLocalRunCheckpointV1 {
    const current = this.#run(taskId)
    if (current.state !== 'completed-pending-sync' || !current.result) throw new Error('only a pending local result can be marked synced')
    return this.#replace(current, { state: 'synced', updatedAt: now.toISOString() })
  }

  resultForSync(taskId: string): Omit<RedactedResultV1, 'tenantId' | 'userId'> {
    const current = this.#run(taskId)
    if (!current.result || !['completed-pending-sync', 'synced'].includes(current.state)) throw new Error('local result is not ready for sync')
    return current.result
  }

  exportCheckpoints(): readonly InactiveLocalRunCheckpointV1[] {
    return deepFreeze([...this.#runs.values()].map(value => structuredClone(value)))
  }

  static async restore(values: readonly InactiveLocalRunCheckpointV1[], verifier: PlanSignatureVerifierV1, now: Date): Promise<InactiveLocalRunJournalV1> {
    const journal = new InactiveLocalRunJournalV1(verifier)
    for (const value of values) {
      if (value.schemaVersion !== 1 || value.externalWritesEnabled !== false || value.effectMode !== 'recording-sink' || value.checkpointDigest !== checkpointDigest(value)) throw new Error('local run checkpoint integrity failed')
      if (journal.#runs.has(value.taskId)) throw new Error('duplicate local run checkpoint')
      if (value.plan.envelope.allowedEffects.length || value.plan.envelope.approvalGrants.length || value.deviceId !== value.plan.envelope.deviceId) throw new Error('restored local run is outside the inactive boundary')
      if (!['leased', 'running', 'paused', 'completed-pending-sync', 'synced', 'cancelled'].includes(value.state) || !Number.isSafeInteger(value.revision) || value.revision < 1 || Number.isNaN(Date.parse(value.updatedAt))) throw new Error('restored local run state is invalid')
      const expectsResult = value.state === 'completed-pending-sync' || value.state === 'synced'
      if (expectsResult !== Boolean(value.result)) throw new Error('restored local run result state is inconsistent')
      if (value.result && (value.result.taskId !== value.taskId || value.result.deviceId !== value.deviceId || value.result.planId !== value.plan.planId || !value.result.summaryCode || unsafeText.test(value.result.summaryCode) || !value.result.artifactDigests.every(digest => /^sha256:[a-f0-9]{64}$/.test(digest)) || Number.isNaN(Date.parse(value.result.completedAt)))) throw new Error('restored local result is invalid')
      const verificationTime = value.result ? new Date(value.plan.issuedAt) : now
      await verifySignedExecutionPlan(value.plan, verifier, verificationTime)
      const adapter = toExecutorAdapterInput(value.executorId, value.plan.envelope)
      if (adapter.normalizedContextDigest !== value.normalizedContextDigest) throw new Error('restored local run context drifted')
      const restored = value.state === 'running'
        ? seal({ ...value, state: 'paused', revision: value.revision + 1, updatedAt: now.toISOString() })
        : deepFreeze(structuredClone(value))
      journal.#runs.set(value.taskId, restored)
    }
    return journal
  }

  #run(taskId: string): InactiveLocalRunCheckpointV1 {
    const value = this.#runs.get(taskId)
    if (!value) throw new Error('local run is unavailable')
    return value
  }

  #replace(current: InactiveLocalRunCheckpointV1, patch: Partial<InactiveLocalRunCheckpointV1>): InactiveLocalRunCheckpointV1 {
    const next = seal({ ...current, ...patch, revision: current.revision + 1 })
    this.#runs.set(current.taskId, next)
    return next
  }
}

function checkpointDigest(value: Omit<InactiveLocalRunCheckpointV1, 'checkpointDigest'> | InactiveLocalRunCheckpointV1): string {
  const { checkpointDigest: _ignored, ...payload } = value as InactiveLocalRunCheckpointV1
  return contentDigest(payload)
}

function seal(value: Omit<InactiveLocalRunCheckpointV1, 'checkpointDigest'>): InactiveLocalRunCheckpointV1 {
  return deepFreeze({ ...value, checkpointDigest: checkpointDigest(value) })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
