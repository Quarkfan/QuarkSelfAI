import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type { PolicyDocument, PolicySimulation } from '../policy/types.js'

export type StorageKind = 'sqlite' | 'postgres'

export interface StoredEvent {
  readonly id: string
  readonly inserted: boolean
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

export interface AssistantStore {
  readonly kind: StorageKind
  migrate(): Promise<void>
  health(): Promise<void>
  close(): Promise<void>
  appendEvent(id: string, event: NormalizedChannelEvent): Promise<StoredEvent>
  updateCheckpoint(consumerName: string, eventKey: string, cursor: Readonly<Record<string, unknown>>): Promise<void>
  overview(): Promise<OverviewCounts>
  recentEvents(limit: number): Promise<readonly EventSummary[]>
  recentMatters(limit: number): Promise<readonly MatterSummary[]>
  recentActions(limit: number): Promise<readonly ActionSummary[]>
  pendingApprovals(limit: number): Promise<readonly ApprovalSummary[]>
  savePolicyDraft(input: PolicyDraftInput): Promise<number>
  activatePolicy(id: string, revision: number, approvedAt: string): Promise<void>
  policies(limit: number): Promise<readonly PolicySummary[]>
}
