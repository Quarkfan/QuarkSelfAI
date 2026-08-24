export type ExecutorId = string
import type { SourceRef } from './channel.js'
export { eventRecordId } from './channel.js'
export type { ChannelId, NormalizedChannelEvent, SourceRef } from './channel.js'

export type ActionState =
  | 'observed'
  | 'settling'
  | 'planned'
  | 'awaiting-approval'
  | 'executing'
  | 'waiting-external'
  | 'completed'
  | 'superseded'
  | 'failed'

export interface ActionRecord {
  readonly id: string
  readonly matterId: string
  readonly state: ActionState
  readonly intent: string
  readonly source: SourceRef
  readonly executor?: ExecutorId
  readonly approvalId?: string
  readonly supersedes?: string
  readonly updatedAt: string
}

export interface ExecutorRequest {
  readonly actionId: string
  readonly title: string
  readonly prompt: string
  readonly workspace: string
  readonly mode: 'read-only' | 'workspace-write' | 'external-write'
}

export interface ExecutorResult {
  readonly actionId: string
  readonly executor: ExecutorId
  readonly status: 'completed' | 'needs-input' | 'failed'
  readonly summary: string
  readonly sessionId?: string
}

export interface ExecutorProvider {
  readonly name: ExecutorId
  execute(request: ExecutorRequest, signal: AbortSignal): Promise<ExecutorResult>
}
