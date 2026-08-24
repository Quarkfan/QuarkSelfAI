export type AssistantIdentity = 'user' | 'bot'
export type ChannelId = string
export type ExecutorId = string

export interface SourceRef {
  readonly channel: ChannelId
  readonly conversationId?: string
  readonly messageId?: string
  readonly eventId?: string
  readonly senderId?: string
}

export interface NormalizedChannelEvent {
  readonly kind: 'message.received' | 'card.action' | 'channel.event'
  readonly source: SourceRef
  readonly occurredAt?: string
  readonly eventKey: string
  readonly deduplicationKey: string
  readonly payload: Readonly<Record<string, unknown>>
  /** Complete adapter payload retained for forward compatibility and replay. */
  readonly raw: Readonly<Record<string, unknown>>
}

/** Stable journal identity shared by every channel ingress implementation. */
export function eventRecordId(event: NormalizedChannelEvent): string {
  return `event:${event.source.channel}:${event.deduplicationKey}`
}

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
