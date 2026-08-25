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

/** Validate the provider-neutral durable envelope before deriving identity or writing storage. */
export function validateNormalizedChannelEvent(event: NormalizedChannelEvent): void {
  nonEmpty(event.kind, 'event kind')
  nonEmpty(event.source.channel, 'event source channel')
  nonEmpty(event.eventKey, 'event key')
  nonEmpty(event.deduplicationKey, 'event deduplication key')
  for (const [name, value] of Object.entries(event.source)) {
    if (value !== undefined) nonEmpty(value, `event source ${name}`)
  }
  if (event.occurredAt !== undefined && Number.isNaN(new Date(event.occurredAt).getTime())) {
    throw new Error('event occurredAt must be a timestamp')
  }
  assertJsonObject(event.payload, 'event payload')
  assertJsonObject(event.raw, 'event raw')
}

/** Stable journal identity shared by every channel ingress implementation. */
export function eventRecordId(event: NormalizedChannelEvent): string {
  validateNormalizedChannelEvent(event)
  return `event:${event.source.channel}:${event.deduplicationKey}`
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.length > 4_096) throw new Error(`${label} exceeds 4096 characters`)
}

function assertJsonObject(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  assertJsonValue(value, label)
}

function assertJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`))
    return
  }
  if (typeof value !== 'object') throw new Error(`${path} contains a non-JSON value`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} contains a non-plain object`)
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) assertJsonValue(item, `${path}.${key}`)
}
