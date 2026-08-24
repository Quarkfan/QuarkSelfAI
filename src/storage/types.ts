import type { ExecutorRequest, ExecutorResult, NormalizedChannelEvent, SourceRef } from '../domain/contracts.js'
import type { PolicyDocument, PolicySimulation } from '../policy/types.js'
import type { PolicySample } from '../policy/types.js'

export type StorageKind = 'sqlite' | 'postgres'

export interface StoredEvent {
  readonly id: string
  readonly inserted: boolean
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
  readonly wakeAt?: string
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

export interface AssistantStore {
  readonly kind: StorageKind
  migrate(): Promise<void>
  health(): Promise<void>
  close(): Promise<void>
  appendEvent(id: string, event: NormalizedChannelEvent): Promise<StoredEvent>
  appendSignal(input: DurableSignalInput): Promise<{ readonly inserted: boolean }>
  recentSignals(kind: string, limit: number): Promise<readonly DurableSignal[]>
  readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined>
  writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void>
  createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean; readonly instance: WorkflowInstance }>
  workflow(id: string): Promise<WorkflowInstance | undefined>
  dueWorkflows(now: string, limit: number): Promise<readonly WorkflowInstance[]>
  advanceWorkflow(input: AdvanceWorkflowInput): Promise<{ readonly advanced: boolean; readonly instance: WorkflowInstance }>
  claimNextWorkflowEffect(workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedWorkflowEffect | undefined>
  settleWorkflowEffect(effectId: string, workerId: string, deliveredAt: string): Promise<void>
  releaseWorkflowEffect(effectId: string, workerId: string, error: string, availableAt: string, terminal: boolean): Promise<void>
  updateCheckpoint(consumerName: string, eventKey: string, cursor: Readonly<Record<string, unknown>>): Promise<void>
  overview(): Promise<OverviewCounts>
  recentEvents(limit: number): Promise<readonly EventSummary[]>
  recentPolicySamples(limit: number): Promise<readonly PolicySample[]>
  recentMatters(limit: number): Promise<readonly MatterSummary[]>
  recentActions(limit: number): Promise<readonly ActionSummary[]>
  pendingApprovals(limit: number): Promise<readonly ApprovalSummary[]>
  savePolicyDraft(input: PolicyDraftInput): Promise<number>
  activatePolicy(id: string, revision: number, approvedAt: string): Promise<void>
  policies(limit: number): Promise<readonly PolicySummary[]>
  enqueueAction(input: DurableActionInput): Promise<{ readonly inserted: boolean }>
  decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt: string): Promise<void>
  claimNextAction(workerId: string, workspace: string, now: string, leaseExpiresAt: string): Promise<ClaimedAction | undefined>
  settleAction(actionId: string, workerId: string, result: ExecutorResult): Promise<void>
  releaseActionClaim(input: ActionClaimRelease): Promise<void>
}
