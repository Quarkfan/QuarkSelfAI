import { createHash } from 'node:crypto'

interface NormalizedChannelEvent {
  readonly kind: string
  readonly source: Readonly<Record<string, string>>
  readonly occurredAt?: string
  readonly eventKey: string
  readonly deduplicationKey: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

interface PendingWorkflow {
  readonly id: string
  readonly kind: string
  readonly definitionVersion: number
  readonly status: 'waiting'
  readonly state: Readonly<Record<string, unknown>>
  readonly effects: readonly { readonly id: string; readonly kind: string; readonly payload: Readonly<Record<string, unknown>>; readonly availableAt: string }[]
}

const FOCUS_DISCOVERY_EVENT_KEY = 'quark.focus.discovered.v1'
const LEGACY_REACTION_REPLAY_EVENT_KEY = 'quark.migration.feishu-reaction.v1'

export interface MessageIntakeHandoff {
  readonly counts: Readonly<Record<string, number>>
  readonly checkpoint: Readonly<Record<string, unknown>>
  readonly pendingEvents: readonly NormalizedChannelEvent[]
  readonly pendingWorkflows: readonly PendingWorkflow[]
  readonly digest: string
}

export interface MessageIntakeHandoffTarget {
  appendEvent(id: string, event: NormalizedChannelEvent): Promise<{ readonly inserted: boolean }>
  createWorkflow(input: PendingWorkflow): Promise<{ readonly inserted: boolean }>
  readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined>
  writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void>
}

const ARRAYS = [
  'queue', 'processedMessageIds', 'processedCardEventIds', 'mentionPending', 'mentionProcessedMessageIds',
  'notificationDigestPending', 'ownerConversation', 'ownerEngagedConversations',
  'ownerEngagementProcessedMessageIds', 'reactionPendingEvents', 'reactionProcessedEventIds',
  'flaggedConversationChatIds', 'delegatedGroupChatIds', 'groupMembershipKnownChatIds',
] as const

const SCALARS = [
  'mentionLastPollAt', 'mentionNextPollAt', 'notificationDigestLastSentAt',
  'ownerEngagementLastPollAt', 'flaggedConversationLastSyncAt', 'groupMembershipLastSyncAt',
] as const

export function prepareMessageIntakeHandoff(value: unknown, capturedAt: string): MessageIntakeHandoff {
  if (!isRecord(value)) throw new Error('compat state must be an object')
  if (Number.isNaN(new Date(capturedAt).getTime())) throw new Error('capturedAt must be an ISO timestamp')
  const selected: Record<string, unknown> = {}
  const counts: Record<string, number> = {}
  for (const key of ARRAYS) {
    const list = Array.isArray(value[key]) ? value[key] : []
    selected[key] = list
    counts[key] = list.length
  }
  for (const key of SCALARS) selected[key] = typeof value[key] === 'string' ? value[key] : null
  selected.reactionStates = isRecord(value.reactionStates) ? value.reactionStates : {}
  counts.reactionStates = Object.keys(selected.reactionStates as Record<string, unknown>).length
  const pendingEvents = [
    ...(selected.mentionPending as readonly unknown[]).map((item, index) => pendingMessageEvent(item, index)),
    ...(selected.reactionPendingEvents as readonly unknown[]).map((item, index) => pendingReactionEvent(item, index)),
  ]
  const pendingWorkflows = digestWorkflows(selected.notificationDigestPending as readonly unknown[], capturedAt)
  const digest = createHash('sha256').update(canonical({ selected, pendingEvents, pendingWorkflows })).digest('hex')
  return {
    counts,
    pendingEvents,
    pendingWorkflows,
    checkpoint: {
      capturedAt,
      lastMessagePollAt: selected.mentionLastPollAt,
      nextMessagePollAt: selected.mentionNextPollAt,
      flaggedConversationLastSyncAt: selected.flaggedConversationLastSyncAt,
      groupMembershipLastSyncAt: selected.groupMembershipLastSyncAt,
    },
    digest,
  }
}

/** Imports frozen pending messages before a native consumer is enabled. */
export async function applyMessageIntakeHandoff(target: MessageIntakeHandoffTarget, handoff: MessageIntakeHandoff, expectedDigest: string) {
  if (handoff.digest !== expectedDigest) throw new Error('message intake handoff digest changed after audit')
  let insertedEvents = 0
  for (const event of handoff.pendingEvents) if ((await target.appendEvent(`event:${event.source.channel}:${event.deduplicationKey}`, event)).inserted) insertedEvents += 1
  let insertedWorkflows = 0
  for (const workflow of handoff.pendingWorkflows) if ((await target.createWorkflow(workflow)).inserted) insertedWorkflows += 1
  const existing = await target.readFeatureCheckpoint('message-intake-handoff', 'compatibility-freeze')
  const checkpoint = { ...handoff.checkpoint, digest: handoff.digest }
  if (existing) {
    if (canonical(existing) !== canonical(checkpoint)) throw new Error('native message intake checkpoint already has different content')
  } else await target.writeFeatureCheckpoint('message-intake-handoff', 'compatibility-freeze', checkpoint)
  return { insertedEvents, existingEvents: handoff.pendingEvents.length - insertedEvents,
    insertedWorkflows, existingWorkflows: handoff.pendingWorkflows.length - insertedWorkflows, writtenCheckpoint: existing ? 0 : 1 }
}

function digestWorkflows(values: readonly unknown[], capturedAt: string): readonly PendingWorkflow[] {
  const items = values.map((value, index) => digestItem(value, index))
  const workflows: PendingWorkflow[] = []
  for (let offset = 0; offset < items.length; offset += 20) {
    const chunk = items.slice(offset, offset + 20)
    const identity = chunk.map(item => `${item.messageId}:${item.queuedAt}`).join('\0')
    const key = createHash('sha256').update(identity).digest('hex').slice(0, 32)
    const effectId = `intake-digest:${key}:notification`
    const availableAt = chunk.map(item => item.deliverAfter ?? new Date(new Date(item.queuedAt).getTime() + 6 * 60 * 60_000).toISOString())
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? capturedAt
    const lines = chunk.map(item => `- **${item.title}**${item.ownerMessage ? `：${item.ownerMessage}` : item.materialChange ? `：${item.materialChange}` : item.nextAction ? `：${item.nextAction}` : ''}\n  ${item.source} · ${item.sender}${item.url ? ` · ${item.url}` : ''}`)
    const sourceEvent: NormalizedChannelEvent = {
      kind: 'channel.event', eventKey: 'quark.migration.notification-digest.v1', deduplicationKey: `notification-digest:${key}`,
      source: { channel: 'compatibility-handoff' }, occurredAt: capturedAt, payload: { itemCount: chunk.length }, raw: {},
    }
    workflows.push({
      id: `message-intake-digest:${key}`, kind: 'message-intake.v1', definitionVersion: 1, status: 'waiting',
      state: { stage: 'reporting', route: 'focus', sourceEvent, workspace: 'compatibility-handoff', pending: [effectId] },
      effects: [{ id: effectId, kind: 'assistant.notify-owner.v1', availableAt, payload: {
        title: chunk.length === 1 && chunk[0]?.notificationTitle ? chunk[0].notificationTitle : '我帮你归拢了几件事',
        body: `我把刚才几条不需要立刻打断你的信息合在一起了，共 ${chunk.length} 件。你有空时扫一眼就行：\n\n${lines.join('\n\n')}\n\n需要你马上决定的事情，我会单独告诉你。`,
        idempotencyKey: `notification-digest:${key}`,
      } }],
    })
  }
  return workflows
}

function digestItem(value: unknown, index: number) {
  const item = isRecord(value) ? value : undefined
  if (!item) throw new Error(`notification digest item ${index} is invalid`)
  const queuedAt = timestamp(item.queuedAt, `notification digest item ${index} queuedAt`)
  const deliverAfter = item.deliverAfter === null || item.deliverAfter === undefined ? undefined : timestamp(item.deliverAfter, `notification digest item ${index} deliverAfter`)
  return {
    messageId: required(item.messageId, `notification digest item ${index} messageId`), queuedAt, deliverAfter,
    title: required(item.title, `notification digest item ${index} title`),
    source: required(item.source, `notification digest item ${index} source`), sender: required(item.sender, `notification digest item ${index} sender`),
    materialChange: optional(item.materialChange), nextAction: optional(item.nextAction), ownerMessage: optional(item.ownerMessage),
    notificationTitle: optional(item.notificationTitle), url: optional(item.url),
  }
}

function optional(value: unknown): string { return typeof value === 'string' ? value : '' }

function pendingMessageEvent(value: unknown, index: number): NormalizedChannelEvent {
  const pending = isRecord(value) ? value : undefined
  const message = isRecord(pending?.message) ? pending.message : undefined
  if (!message) throw new Error(`pending message ${index} is invalid`)
  const messageId = required(message.message_id, `pending message ${index} id`)
  const chatId = required(message.chat_id, `pending message ${index} chat id`)
  const content = required(message.content, `pending message ${index} content`)
  const sender = isRecord(message.sender) ? message.sender : {}
  const occurredAt = timestamp(message.create_time, `pending message ${index} create time`)
  return {
    kind: 'message.received', eventKey: FOCUS_DISCOVERY_EVENT_KEY, deduplicationKey: messageId,
    source: { channel: 'feishu', resourceId: messageId, containerId: chatId, ...(typeof sender.id === 'string' && sender.id ? { actorId: sender.id } : {}) },
    occurredAt,
    payload: {
      text: content, content,
      ...(typeof message.chat_type === 'string' ? { chatType: message.chat_type } : {}),
      ...(Array.isArray(message.mentions) ? { mentions: message.mentions } : {}),
      ...(typeof message.reply_to === 'string' ? { replyTo: message.reply_to } : {}),
      ...(typeof message.root_id === 'string' ? { rootId: message.root_id } : {}),
      ...(typeof message.thread_id === 'string' ? { threadId: message.thread_id } : {}),
    },
    raw: message,
  }
}

function pendingReactionEvent(value: unknown, index: number): NormalizedChannelEvent {
  const item = isRecord(value) ? value : undefined
  if (!item) throw new Error(`pending reaction ${index} is invalid`)
  const eventId = required(item.eventId, `pending reaction ${index} event id`)
  const messageId = required(item.messageId, `pending reaction ${index} message id`)
  const operatorId = required(item.operatorId, `pending reaction ${index} operator id`)
  const emojiType = required(item.emojiType, `pending reaction ${index} emoji type`)
  const occurredAt = timestamp(item.occurredAt, `pending reaction ${index} occurred at`)
  const operation = item.operation === 'deleted' ? 'deleted' : item.operation === 'created' ? 'created' : undefined
  if (!operation) throw new Error(`pending reaction ${index} operation is invalid`)
  const raw = { eventId, messageId, operatorId, emojiType, operation, occurredAt }
  return {
    kind: 'channel.event', eventKey: LEGACY_REACTION_REPLAY_EVENT_KEY, deduplicationKey: eventId,
    source: { channel: 'feishu', resourceId: messageId, eventId, actorId: operatorId }, occurredAt,
    payload: { operation, emojiType, operatorType: typeof item.operatorType === 'string' ? item.operatorType : 'user', migratedFromCompatibility: true },
    raw,
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a timestamp`)
  return new Date(value).toISOString()
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
