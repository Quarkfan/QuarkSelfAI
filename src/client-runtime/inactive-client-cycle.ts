import type { DeviceSessionServerPortV1 } from '../control-plane/contracts.js'
import { signDeviceSessionChallenge } from './device-identity.js'
import type { LocalDeviceSecretStoreV1 } from './contracts.js'
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
  return receipt({ state: 'lease-accepted-inactive', sessionId: session.sessionId, taskId: lease.taskId, planId: lease.planId, executorId: selection.executorId, checkpointDigest: checkpoint.checkpointDigest })
}

function receipt(input: Pick<InactiveClientCycleReceiptV1, 'state' | 'sessionId'> & Partial<Pick<InactiveClientCycleReceiptV1, 'taskId' | 'planId' | 'executorId' | 'checkpointDigest'>>): InactiveClientCycleReceiptV1 {
  return Object.freeze({ schemaVersion: 1, state: input.state, sessionId: input.sessionId, taskId: input.taskId ?? null, planId: input.planId ?? null,
    executorId: input.executorId ?? null, checkpointDigest: input.checkpointDigest ?? null, executorInvoked: false, effectsActive: 0, externalWritesEnabled: false, currentOwnerPreserved: true })
}
