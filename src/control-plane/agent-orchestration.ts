import { compileNoEffectExecutionPlan } from '../orchestration/blueprint-compiler.js'
import type {
  AgentTestDispatchReceiptV1, DeviceDispatchQueuePortV1, ExecutionPlanSignerV1,
  PersistentAgentOrchestrationPortV1, PersistentAgentStudioPortV1,
  PersistentCapabilityRegistryPortV1, TenantContextV1, TenantDevicePortV1,
} from './contracts.js'
import type { TenantAuthorizationPortV1 } from './tenant-persistence.js'

const idPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/
type IdLabel = 'run' | 'action' | 'plan' | 'task' | 'idempotency'
export interface AgentOrchestrationIdSourceV1 { next(label: IdLabel): string }

/** Compiles and queues one signed, effects-off Agent test release for one enrolled device. */
export class RegisteredNoEffectAgentOrchestratorV1 implements PersistentAgentOrchestrationPortV1 {
  constructor(
    private readonly studio: PersistentAgentStudioPortV1,
    private readonly capabilities: PersistentCapabilityRegistryPortV1,
    private readonly devices: TenantDevicePortV1,
    private readonly queue: DeviceDispatchQueuePortV1,
    private readonly signer: ExecutionPlanSignerV1,
    private readonly ids: AgentOrchestrationIdSourceV1,
    private readonly authorization: TenantAuthorizationPortV1,
  ) {}

  async dispatchTest(context: TenantContextV1, input: { readonly draftId: string; readonly expectedRevision: number; readonly deviceId: string }, now = new Date()): Promise<AgentTestDispatchReceiptV1> {
    if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'deviceId,draftId,expectedRevision' || !idPattern.test(input.draftId) || !idPattern.test(input.deviceId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || Number.isNaN(now.getTime())) throw new Error('Agent test dispatch input is invalid')
    if (!await this.authorization.authorize({ context, action: 'agent-test.dispatch', subjectRef: `agent-draft:${input.draftId}` })) throw new Error('Agent test dispatch is not authorized')
    const draft = await this.studio.getDraft(context, input.draftId)
    if (!draft || draft.revision !== input.expectedRevision || draft.state !== 'test-released') throw new Error('Agent test dispatch requires the exact test-released draft')
    const release = await this.studio.getTestRelease(context, draft.blueprint.id, draft.blueprint.version)
    if (!release || release.draftId !== draft.draftId || release.draftRevision !== draft.revision || release.blueprintDigest !== draft.blueprint.digest) throw new Error('Agent test release lineage is invalid')
    const device = (await this.devices.listDevices(context)).find(item => item.deviceId === input.deviceId)
    if (!device || device.userId !== context.userId || device.state !== 'registered') throw new Error('Agent test device is unavailable or outside the user scope')
    const available = await this.capabilities.listVisible(context)
    const ids = Object.fromEntries((['run', 'action', 'plan', 'task', 'idempotency'] as const).map(label => [label, exactId(this.ids.next(label), label)])) as Record<IdLabel, string>
    const issuedAt = now.toISOString(); const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString()
    const plan = await compileNoEffectExecutionPlan(draft.blueprint, available.map(item => item.manifest), {
      tenantId: context.tenantId, userId: context.userId, deviceId: device.deviceId,
      runId: ids.run, actionId: ids.action, planId: ids.plan, idempotencyKey: ids.idempotency,
      issuedAt, expiresAt, context: [], workspaceGrants: [],
    }, this.signer, 'registered')
    const dispatch = await this.queue.enqueue({ tenantId: context.tenantId, userId: context.userId, taskId: ids.task, deviceId: device.deviceId, plan, idempotencyKey: ids.idempotency, state: 'queued', createdAt: issuedAt }, now)
    return Object.freeze({ schemaVersion: 1, tenantId: context.tenantId, userId: context.userId, deviceId: device.deviceId,
      draftId: draft.draftId, draftRevision: draft.revision, taskId: dispatch.taskId, planId: plan.planId,
      blueprintDigest: draft.blueprint.digest, planDigest: plan.payloadDigest, state: 'queued', externalWritesEnabled: false })
  }
}

function exactId(value: string, label: IdLabel): string { if (!idPattern.test(value)) throw new Error(`Agent test ${label} id is invalid`); return value }
