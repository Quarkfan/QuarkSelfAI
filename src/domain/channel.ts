export type ChannelId = string
/** Open semantic event id owned by adapters and consuming features. */
export type ChannelEventKind = string

export interface SourceRef {
  readonly channel: ChannelId
  readonly conversationId?: string
  readonly messageId?: string
  readonly eventId?: string
  readonly senderId?: string
}

export interface NormalizedChannelEvent {
  readonly kind: ChannelEventKind
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
