import { executorParityInputs } from '../capability-sdk/index.js'
import type { CapabilityManifestV1 } from '../capability-platform/manifest.js'
import type { DeviceProofVerifierV1, DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseAcknowledgementV1, DeviceTaskLeaseV1 } from '../client-runtime/contracts.js'
import type { AgentTestReleaseV1, DispatchRecordV1, ExecutionPlanSignerV1, TenantContextV1, TestAgentStudioPortV1, TestTenantControlPlanePortV1 } from '../control-plane/contracts.js'
import type { TestPlanCompilationInputV1 } from './blueprint-compiler.js'
import { compileTestExecutionPlan } from './blueprint-compiler.js'

export interface InactiveShadowRunInputV1 {
  readonly context: TenantContextV1
  readonly release: AgentTestReleaseV1
  readonly manifests: readonly CapabilityManifestV1[]
  readonly compilation: TestPlanCompilationInputV1
  readonly taskId: string
  readonly executorIds: readonly string[]
  readonly now: Date
  readonly deviceProof: (challenge: DeviceSessionChallengeV1) => DeviceSessionProofV1 | Promise<DeviceSessionProofV1>
}

export interface InactiveShadowRunReceiptV1 {
  readonly schemaVersion: 1
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly taskId: string
  readonly blueprintDigest: string
  readonly planDigest: string
  readonly executorContexts: readonly { readonly executorId: string; readonly normalizedContextDigest: string }[]
  readonly state: 'leased-unexecuted'
  readonly leaseAttempt: number
  readonly externalWritesEnabled: false
  readonly executorInvoked: false
  readonly currentOwnerPreserved: true
}

export interface InactiveShadowRunDependenciesV1 {
  readonly studio: TestAgentStudioPortV1
  readonly controlPlane: TestTenantControlPlanePortV1
  readonly deviceSync: InactiveShadowDeviceSyncPortV1
  readonly signer: ExecutionPlanSignerV1
  readonly deviceProofVerifier: DeviceProofVerifierV1
}

export interface InactiveShadowDeviceSyncPortV1 {
  enqueue(dispatch: DispatchRecordV1): void
  issueChallenge(input: { tenantId: string; userId: string; deviceId: string }, now: Date): DeviceSessionChallengeV1
  openSession(proof: DeviceSessionProofV1, verifier: DeviceProofVerifierV1, now: Date): Promise<DeviceSessionV1>
  poll(sessionId: string, now: Date): DeviceTaskLeaseV1 | null
  acknowledge(sessionId: string, leaseToken: string, taskId: string, now: Date): DeviceTaskLeaseAcknowledgementV1
}

/**
 * Connects already-inactive reference components in memory. It stops after a
 * device lease is acknowledged and never invokes an executor or completes a task.
 */
export async function prepareInactiveShadowRun(
  dependencies: InactiveShadowRunDependenciesV1,
  input: InactiveShadowRunInputV1,
): Promise<InactiveShadowRunReceiptV1> {
  const { context, release, compilation } = input
  if (!context.tenantId.startsWith('test.')) throw new Error('inactive shadow run accepts test tenants only')
  if (release.tenantId !== context.tenantId || release.userId !== context.userId || release.state !== 'test') throw new Error('Agent Studio release is outside the requested scope')
  if (compilation.tenantId !== context.tenantId || compilation.userId !== context.userId) throw new Error('plan compilation scope does not match Agent Studio scope')
  const draft = dependencies.studio.getDraft(context, release.draftId)
  if (!draft || draft.state !== 'test-released' || draft.revision !== release.draftRevision) throw new Error('Agent Studio test release is not authoritative')
  if (draft.blueprint.id !== release.blueprintId || draft.blueprint.version !== release.version || draft.blueprint.digest !== release.blueprintDigest) throw new Error('Agent Studio release identity drifted from its Blueprint')

  const declaredExecutors = [...draft.blueprint.executorPolicy.preferred, ...draft.blueprint.executorPolicy.fallback]
  if (input.executorIds.length !== declaredExecutors.length || input.executorIds.some((id, index) => id !== declaredExecutors[index])) throw new Error('shadow executor adapters must exactly match Blueprint policy order')

  const plan = await compileTestExecutionPlan(draft.blueprint, input.manifests, compilation, dependencies.signer)
  dependencies.controlPlane.publishBlueprint(context, {
    blueprintId: release.blueprintId,
    version: release.version,
    blueprintDigest: release.blueprintDigest,
    state: 'test',
  }, input.now)
  const dispatch = dependencies.controlPlane.dispatch(context, {
    taskId: input.taskId,
    deviceId: compilation.deviceId,
    plan,
    idempotencyKey: compilation.idempotencyKey,
  }, input.now)
  dependencies.deviceSync.enqueue(dispatch)

  const challenge = dependencies.deviceSync.issueChallenge({ tenantId: context.tenantId, userId: context.userId, deviceId: compilation.deviceId }, input.now)
  const proof = await input.deviceProof(challenge)
  const session = await dependencies.deviceSync.openSession(proof, dependencies.deviceProofVerifier, input.now)
  const lease = dependencies.deviceSync.poll(session.sessionId, input.now)
  if (!lease) throw new Error('inactive shadow task was not leased')
  const acknowledgement = dependencies.deviceSync.acknowledge(session.sessionId, lease.leaseToken, lease.taskId, input.now)
  dependencies.controlPlane.acknowledgeLease(context, { taskId: acknowledgement.taskId, planId: acknowledgement.planId, deviceId: acknowledgement.deviceId }, input.now)

  const contexts = executorParityInputs(input.executorIds, lease.plan.envelope).map(adapter => ({
    executorId: adapter.executorId,
    normalizedContextDigest: adapter.normalizedContextDigest,
  }))
  return deepFreeze({
    schemaVersion: 1,
    tenantId: context.tenantId,
    userId: context.userId,
    deviceId: compilation.deviceId,
    taskId: input.taskId,
    blueprintDigest: release.blueprintDigest,
    planDigest: plan.payloadDigest,
    executorContexts: contexts,
    state: 'leased-unexecuted',
    leaseAttempt: lease.attempt,
    externalWritesEnabled: false,
    executorInvoked: false,
    currentOwnerPreserved: true,
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
