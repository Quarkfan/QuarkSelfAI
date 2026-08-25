export type ChannelId = string
/** Open semantic event id owned by adapters and consuming features. */
export type ChannelEventKind = string

export interface SourceRef {
  readonly channel: ChannelId
  /** Provider-neutral resource identity, for example a message, calendar event or document revision. */
  readonly resourceId?: string
  /** Optional containing scope, for example a chat, calendar or document. */
  readonly containerId?: string
  readonly eventId?: string
  readonly actorId?: string
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
