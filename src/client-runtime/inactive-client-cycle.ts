import type { DeviceSessionServerPortV1 } from '../control-plane/contracts.js'
import { toExecutorAdapterInput } from '../capability-platform/validation.js'
import { signDeviceSessionChallenge } from './device-identity.js'
import type { LocalDeviceSecretStoreV1, NoEffectClientExecutorPortV1 } from './contracts.js'
import { negotiateExecutor } from './negotiation.js'
import type { SqliteInactiveClientStateV1 } from './sqlite-client-state.js'

export interface InactiveClientCycleReceiptV1 {
  readonly schemaVersion: 1
  readonly state: 'online-empty' | 'lease-accepted-inactive'
  readonly sessionId: string
  readonly taskId: string | null
  readonly planId: string | null
  readonly executorId: string | null
  readonly checkpointDigest: string | null
  readonly executorInvoked: false
  readonly effectsActive: 0
  readonly externalWritesEnabled: false
  readonly currentOwnerPreserved: true
}

export interface NoEffectClientExecutionReceiptV1 {
  readonly schemaVersion: 1
  readonly state: 'online-empty' | 'result-synced'
  readonly sessionId: string
  readonly taskId: string | null
  readonly planId: string | null
  readonly executorId: string | null
  readonly checkpointDigest: string | null
  readonly executorInvoked: boolean
  readonly effectsActive: 0
  readonly externalWritesEnabled: false
  readonly currentOwnerPreserved: true
}

/** One device-authenticated poll. It durably accepts at most one no-effect lease and never invokes an executor. */
export async function runInactiveClientCycle(input: {
  readonly state: SqliteInactiveClientStateV1
  readonly secrets: LocalDeviceSecretStoreV1
  readonly server: DeviceSessionServerPortV1
  readonly now: Date
}): Promise<InactiveClientCycleReceiptV1> {
  if (Number.isNaN(input.now.getTime())) throw new Error('inactive client cycle timestamp is invalid')
  const enrollment = input.state.localEnrollment()
  const scope = { tenantId: enrollment.identity.tenantId, userId: enrollment.identity.userId, deviceId: enrollment.identity.deviceId }
  const challenge = await input.server.issueChallenge(scope, input.now)
  const proof = await signDeviceSessionChallenge({ identity: enrollment.identity, privateKeyRef: enrollment.privateKeyRef, challenge }, input.secrets)
  const session = await input.server.openSession(proof, input.now)
  if (session.tenantId !== scope.tenantId || session.userId !== scope.userId || session.deviceId !== scope.deviceId || session.state !== 'active') throw new Error('device session scope does not match local enrollment')
  const lease = await input.server.poll(session.sessionId, input.now)
  if (!lease) return receipt({ state: 'online-empty', sessionId: session.sessionId })
  if (lease.deviceId !== enrollment.identity.deviceId || lease.externalWritesEnabled !== false) throw new Error('device lease is outside the inactive client scope')
  const reports = input.state.cloudProjection(input.now).executorReports
  const selection = negotiateExecutor(lease.plan.envelope.executorRequirement, reports, input.now)
  const journal = await input.state.restoreRunJournal(input.now)
  const checkpoint = await journal.acceptLease(lease, selection.executorId, input.now)
  await input.state.saveRunCheckpoint(checkpoint, input.now)
  const acknowledgement = await input.server.acknowledge(session.sessionId, { leaseToken: lease.leaseToken, taskId: lease.taskId }, input.now)
  if (acknowledgement.planId !== lease.planId || acknowledgement.deviceId !== lease.deviceId || acknowledgement.state !== 'accepted') throw new Error('device lease acknowledgement drifted')
  const accepted = journal.markLeaseAcknowledged(lease.taskId, input.now)
  await input.state.saveRunCheckpoint(accepted, input.now)
  return receipt({ state: 'lease-accepted-inactive', sessionId: session.sessionId, taskId: lease.taskId, planId: lease.planId, executorId: selection.executorId, checkpointDigest: accepted.checkpointDigest })
}

/**
 * Explicit no-effect execution cycle. It invokes only the preselected executor,
 * durably checkpoints every transition and resumes local work before polling a
 * new lease. It has no internal fallback and cannot accept effectful plans.
 */
export async function runNoEffectClientExecutionCycle(input: {
  readonly state: SqliteInactiveClientStateV1
  readonly secrets: LocalDeviceSecretStoreV1
  readonly server: DeviceSessionServerPortV1
  readonly executors: readonly NoEffectClientExecutorPortV1[]
  readonly now: Date
}): Promise<NoEffectClientExecutionReceiptV1> {
  if (Number.isNaN(input.now.getTime())) throw new Error('client execution cycle timestamp is invalid')
  const executors = executorIndex(input.executors)
  const enrollment = input.state.localEnrollment()
  const scope = { tenantId: enrollment.identity.tenantId, userId: enrollment.identity.userId, deviceId: enrollment.identity.deviceId }
  const challenge = await input.server.issueChallenge(scope, input.now)
  const proof = await signDeviceSessionChallenge({ identity: enrollment.identity, privateKeyRef: enrollment.privateKeyRef, challenge }, input.secrets)
  const session = await input.server.openSession(proof, input.now)
  if (session.tenantId !== scope.tenantId || session.userId !== scope.userId || session.deviceId !== scope.deviceId || session.state !== 'active') throw new Error('device session scope does not match local enrollment')

  const journal = await input.state.restoreRunJournal(input.now)
  const checkpoints = journal.exportCheckpoints()
  const pending = checkpoints.find(item => ['accepted', 'paused', 'completed-pending-sync'].includes(item.state))
  if (pending) return await resumeNoEffectRun(input, session.sessionId, journal, pending.taskId, executors)
  const unacknowledged = checkpoints.find(item => item.state === 'leased')

  const lease = await input.server.poll(session.sessionId, input.now)
  if (!lease) {
    if (unacknowledged) throw new Error('leased local task requires server acknowledgement reconciliation')
    return executionReceipt({ state: 'online-empty', sessionId: session.sessionId, executorInvoked: false })
  }
  if (lease.deviceId !== enrollment.identity.deviceId || lease.externalWritesEnabled !== false) throw new Error('device lease is outside the no-effect client scope')
  const selection = negotiateExecutor(lease.plan.envelope.executorRequirement, input.state.cloudProjection(input.now).executorReports, input.now)
  const checkpoint = await journal.acceptLease(lease, selection.executorId, input.now)
  await input.state.saveRunCheckpoint(checkpoint, input.now)
  const acknowledgement = await input.server.acknowledge(session.sessionId, { leaseToken: lease.leaseToken, taskId: lease.taskId }, input.now)
  if (acknowledgement.planId !== lease.planId || acknowledgement.deviceId !== lease.deviceId || acknowledgement.state !== 'accepted') throw new Error('device lease acknowledgement drifted')
  const accepted = journal.markLeaseAcknowledged(lease.taskId, input.now)
  await input.state.saveRunCheckpoint(accepted, input.now)
  return await resumeNoEffectRun(input, session.sessionId, journal, lease.taskId, executors)
}

async function resumeNoEffectRun(
  input: { readonly state: SqliteInactiveClientStateV1; readonly server: DeviceSessionServerPortV1; readonly now: Date },
  sessionId: string,
  journal: Awaited<ReturnType<SqliteInactiveClientStateV1['restoreRunJournal']>>,
  taskId: string,
  executors: ReadonlyMap<string, NoEffectClientExecutorPortV1>,
): Promise<NoEffectClientExecutionReceiptV1> {
  let checkpoint = journal.exportCheckpoints().find(item => item.taskId === taskId)
  if (!checkpoint) throw new Error('local execution checkpoint disappeared')
  let executorInvoked = false
  if (checkpoint.state === 'accepted' || checkpoint.state === 'paused') {
    const executor = executors.get(checkpoint.executorId)
    if (!executor) throw new Error('selected executor is unavailable for local resume')
    checkpoint = journal.begin(taskId, input.now)
    await input.state.saveRunCheckpoint(checkpoint, input.now)
    try {
      const result = await executor.execute(toExecutorAdapterInput(checkpoint.executorId, checkpoint.plan.envelope))
      executorInvoked = true
      checkpoint = journal.completePendingSync(taskId, result, input.now)
    } catch (error) {
      checkpoint = journal.pause(taskId, input.now)
      await input.state.saveRunCheckpoint(checkpoint, input.now)
      throw error
    }
    await input.state.saveRunCheckpoint(checkpoint, input.now)
  }
  if (checkpoint.state !== 'completed-pending-sync') throw new Error('local execution is not ready to synchronize')
  const result = journal.resultForSync(taskId)
  const accepted = await input.server.submitResult(sessionId, result, input.now)
  if (accepted.taskId !== taskId || accepted.planId !== checkpoint.plan.planId || accepted.deviceId !== checkpoint.deviceId) throw new Error('device result acknowledgement drifted')
  checkpoint = journal.markSynced(taskId, input.now)
  await input.state.saveRunCheckpoint(checkpoint, input.now)
  return executionReceipt({ state: 'result-synced', sessionId, taskId, planId: checkpoint.plan.planId, executorId: checkpoint.executorId, checkpointDigest: checkpoint.checkpointDigest, executorInvoked })
}

function executorIndex(values: readonly NoEffectClientExecutorPortV1[]): ReadonlyMap<string, NoEffectClientExecutorPortV1> {
  const result = new Map<string, NoEffectClientExecutorPortV1>()
  for (const executor of values) {
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(executor.executorId) || result.has(executor.executorId)) throw new Error('client executors must have unique safe ids')
    result.set(executor.executorId, executor)
  }
  return result
}

function executionReceipt(input: Pick<NoEffectClientExecutionReceiptV1, 'state' | 'sessionId' | 'executorInvoked'> & Partial<Pick<NoEffectClientExecutionReceiptV1, 'taskId' | 'planId' | 'executorId' | 'checkpointDigest'>>): NoEffectClientExecutionReceiptV1 {
  return Object.freeze({ schemaVersion: 1, state: input.state, sessionId: input.sessionId, taskId: input.taskId ?? null, planId: input.planId ?? null,
    executorId: input.executorId ?? null, checkpointDigest: input.checkpointDigest ?? null, executorInvoked: input.executorInvoked, effectsActive: 0, externalWritesEnabled: false, currentOwnerPreserved: true })
}

function receipt(input: Pick<InactiveClientCycleReceiptV1, 'state' | 'sessionId'> & Partial<Pick<InactiveClientCycleReceiptV1, 'taskId' | 'planId' | 'executorId' | 'checkpointDigest'>>): InactiveClientCycleReceiptV1 {
  return Object.freeze({ schemaVersion: 1, state: input.state, sessionId: input.sessionId, taskId: input.taskId ?? null, planId: input.planId ?? null,
    executorId: input.executorId ?? null, checkpointDigest: input.checkpointDigest ?? null, executorInvoked: false, effectsActive: 0, externalWritesEnabled: false, currentOwnerPreserved: true })
}
