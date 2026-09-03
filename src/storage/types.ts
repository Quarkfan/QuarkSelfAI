import type { ExecutorRequest, ExecutorResult, NormalizedChannelEvent, SourceRef } from '../domain/contracts.js'
import type { PolicyDocument, PolicySimulation } from '../policy/types.js'

export interface StoredEvent {
  readonly id: string
  readonly inserted: boolean
}

export interface EventPayloadRecord {
  readonly id: string
  readonly source: Readonly<Record<string, unknown>>
  readonly payload: Readonly<Record<string, unknown>>
}

export interface ClaimedChannelEvent {
  readonly id: string
  readonly event: NormalizedChannelEvent
  readonly attempt: number
}

export interface EventClaimRelease {
  readonly consumerName: string
  readonly eventId: string
  readonly workerId: string
  readonly error: string
  readonly availableAt: string
  readonly terminal: boolean
}

export interface DurableSignalInput {
  readonly id: string
  readonly kind: string
  readonly occurredAt: string
  readonly scope?: Readonly<Record<string, unknown>>
  readonly data: Readonly<Record<string, unknown>>
}

export interface DurableSignal extends DurableSignalInput {
  readonly recordedAt: string
}

export type WorkflowStatus = 'running' | 'waiting' | 'completed' | 'failed'

export interface WorkflowEffectInput {
  readonly id: string
  readonly kind: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly availableAt?: string
}

export interface WorkflowInstance {
  readonly id: string
  readonly kind: string
  readonly definitionVersion: number
  readonly status: WorkflowStatus
  readonly state: Readonly<Record<string, unknown>>
  readonly revision: number
  readonly wakeAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateWorkflowInput {
  readonly id: string
  readonly kind: string
  readonly definitionVersion: number
  readonly status: WorkflowStatus
  readonly state: Readonly<Record<string, unknown>>
  readonly wakeAt?: string
  readonly effects?: readonly WorkflowEffectInput[]
}

export interface AdvanceWorkflowInput {
  readonly instanceId: string
  readonly expectedRevision: number
  readonly event: {
    readonly id: string
    readonly type: string
    readonly occurredAt: string
    readonly payload: Readonly<Record<string, unknown>>
  }
  readonly status: WorkflowStatus
  readonly state: Readonly<Record<string, unknown>>
  readonly wakeAt?: string | null
  readonly effects?: readonly WorkflowEffectInput[]
}

export interface ClaimedWorkflowEffect {
  readonly id: string
  readonly instanceId: string
  readonly kind: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly attempt: number
}

export interface OverviewCounts {
  readonly events: number
  readonly openMatters: number
  readonly activeActions: number
  readonly pendingApprovals: number
  readonly failedActions: number
}

export interface EventSummary {
  readonly id: string
  readonly kind: NormalizedChannelEvent['kind']
  readonly eventKey: string
  readonly deduplicationKey: string
  readonly source: Readonly<Record<string, unknown>>
  readonly occurredAt: string | null
  readonly receivedAt: string
}

export interface MatterSummary {
  readonly id: string
  readonly status: string
  readonly title: string
  readonly latestSummary: string
  readonly updatedAt: string
}

export interface ActionSummary {
  readonly id: string
  readonly matterId: string
  readonly state: string
  readonly intent: string
  readonly executor: string | null
  readonly updatedAt: string
}

export interface ApprovalSummary {
  readonly id: string
  readonly actionId: string
  readonly status: string
  readonly prompt: string
  readonly requestedAt: string
}

export interface PolicySummary {
  readonly id: string
  readonly name: string
  readonly status: 'draft' | 'enabled' | 'disabled'
  readonly revision: number
  readonly sourceText: string
  readonly document: PolicyDocument
  readonly simulation: PolicySimulation
  readonly updatedAt: string
}

export interface PolicyDraftInput {
  readonly id: string
  readonly name: string
  readonly sourceText: string
  readonly document: PolicyDocument
  readonly simulation: PolicySimulation
}

export interface DurableActionInput {
  readonly actionId: string
  readonly matterId: string
  readonly matterTitle: string
  readonly matterSummary: string
  readonly intent: string
  readonly source: SourceRef
  readonly request: Omit<ExecutorRequest, 'actionId'>
  readonly requestedExecutor?: ExecutorResult['executor']
  readonly approval?: {
    readonly id: string
    readonly prompt: string
  }
}

export interface ClaimedAction {
  readonly actionId: string
  readonly request: ExecutorRequest
  readonly requestedExecutor?: ExecutorResult['executor']
  readonly approvalGranted: boolean
  readonly attempt: number
}

export interface ActionClaimRelease {
  readonly actionId: string
  readonly workerId: string
  readonly disposition: 'retry' | 'failed'
  readonly error: string
  readonly availableAt?: string
}

/** Connection ownership and process lifecycle. Business components should depend on a narrower port below. */
export interface StorageLifecyclePort {
  /** Open provider identifier; the skeleton must not enumerate database products. */
  readonly kind: string
  migrate(): Promise<void>
  health(): Promise<void>
  close(): Promise<void>
}

export interface EventJournalStorePort {
  appendEvent(id: string, event: NormalizedChannelEvent): Promise<StoredEvent>
  claimNextEvent(consumerName: string, eventKeys: readonly string[], workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedChannelEvent | undefined>
  settleEvent(consumerName: string, eventId: string, workerId: string, deliveredAt: string): Promise<void>
  releaseEvent(input: EventClaimRelease): Promise<void>
  updateCheckpoint(consumerName: string, eventKey: string, cursor: Readonly<Record<string, unknown>>): Promise<void>
  /** Generic replay/query surface. Product features own the interpretation of source and payload. */
  recentEventPayloads(kind: string, limit: number): Promise<readonly EventPayloadRecord[]>
}

export interface SignalStorePort {
  appendSignal(input: DurableSignalInput): Promise<{ readonly inserted: boolean }>
  recentSignals(kind: string, limit: number): Promise<readonly DurableSignal[]>
}

export interface FeatureCheckpointStorePort {
  readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined>
  writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void>
}

export interface WorkflowStorePort {
  createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean; readonly instance: WorkflowInstance }>
  workflow(id: string): Promise<WorkflowInstance | undefined>
  dueWorkflows(now: string, limit: number): Promise<readonly WorkflowInstance[]>
  advanceWorkflow(input: AdvanceWorkflowInput): Promise<{ readonly advanced: boolean; readonly instance: WorkflowInstance }>
  claimNextWorkflowEffect(workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedWorkflowEffect | undefined>
  settleWorkflowEffect(effectId: string, workerId: string, deliveredAt: string): Promise<void>
  releaseWorkflowEffect(effectId: string, workerId: string, error: string, availableAt: string, terminal: boolean): Promise<void>
}

export interface ControlReadStorePort {
  overview(): Promise<OverviewCounts>
  recentEvents(limit: number): Promise<readonly EventSummary[]>
  recentMatters(limit: number): Promise<readonly MatterSummary[]>
  recentActions(limit: number): Promise<readonly ActionSummary[]>
  pendingApprovals(limit: number): Promise<readonly ApprovalSummary[]>
}

export interface PolicyStorePort {
  savePolicyDraft(input: PolicyDraftInput): Promise<number>
  activatePolicy(id: string, revision: number, approvedAt: string): Promise<void>
  policies(limit: number): Promise<readonly PolicySummary[]>
}

export interface ActionStorePort {
  enqueueAction(input: DurableActionInput): Promise<{ readonly inserted: boolean }>
  decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt: string): Promise<void>
  claimNextAction(workerId: string, workspace: string, now: string, leaseExpiresAt: string): Promise<ClaimedAction | undefined>
  settleAction(actionId: string, workerId: string, result: ExecutorResult): Promise<void>
  releaseActionClaim(input: ActionClaimRelease): Promise<void>
}

/** Concrete provider aggregate. Consumers must select the smallest capability port they need. */
export interface AssistantStore extends
  StorageLifecyclePort,
  EventJournalStorePort,
  SignalStorePort,
  FeatureCheckpointStorePort,
  WorkflowStorePort,
  ControlReadStorePort,
  PolicyStorePort,
  ActionStorePort {}

export type ConsoleStorePort = Pick<StorageLifecyclePort, 'kind' | 'health'>
  & Pick<EventJournalStorePort, 'recentEventPayloads'>
  & SignalStorePort
  & FeatureCheckpointStorePort
  & ControlReadStorePort
  & PolicyStorePort
export type PolicyAuthoringStorePort = Pick<PolicyStorePort, 'savePolicyDraft' | 'activatePolicy'>
