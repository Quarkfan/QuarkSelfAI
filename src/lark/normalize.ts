import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { isRecord } from './json.js'

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function timestamp(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  const epoch = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  const date = Number.isFinite(epoch) ? new Date(epoch) : new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Convert Feishu's message-content envelope into the channel-neutral text fact. */
export function normalizeLarkMessageText(value: unknown): string | undefined {
  if (isRecord(value)) return text(value.text)
  const raw = text(value)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? text(parsed.text) : undefined
  } catch {
    return raw
  }
}

export function normalizeLarkEvent(eventKey: string, value: unknown): NormalizedChannelEvent {
  if (!isRecord(value)) throw new Error(`event ${eventKey} payload must be an object`)
  const eventId = text(value.event_id)
  const messageId = text(value.message_id) ?? text(value.id)
  const conversationId = text(value.chat_id)
  const senderId = text(value.sender_id)
  const occurredAt = timestamp(value.timestamp) ?? timestamp(value.create_time)
  const common = {
    source: {
      channel: 'feishu' as const,
      ...(conversationId ? { containerId: conversationId } : {}),
      ...(messageId ? { resourceId: messageId } : {}),
      ...(eventId ? { eventId } : {}),
      ...(senderId ? { actorId: senderId } : {}),
    },
    ...(occurredAt ? { occurredAt } : {}),
    eventKey,
    raw: value,
  }
  if (eventKey === 'im.message.receive_v1') {
    return {
      ...common,
      kind: 'message.received',
      deduplicationKey: messageId ?? eventId ?? `${eventKey}:${JSON.stringify(value)}`,
      payload: {
        text: normalizeLarkMessageText(value.content),
        content: value.content,
        messageType: value.message_type,
        chatType: value.chat_type,
        mentions: value.mentions,
        replyTo: value.reply_to,
        rootId: value.root_id,
        threadId: value.thread_id,
      },
    }
  }
  if (eventKey === 'card.action.trigger') {
    return {
      ...common,
      kind: 'card.action',
      deduplicationKey: eventId ?? `${messageId ?? 'card'}:${String(value.action_name ?? value.action_tag ?? '')}`,
      payload: {
        operatorId: value.operator_id,
        actionName: value.action_name,
        actionTag: value.action_tag,
        actionValue: value.action_value,
        formValue: value.form_value,
        inputValue: value.input_value,
        token: value.token,
      },
    }
  }
  return {
    ...common,
    kind: 'channel.event',
    deduplicationKey: eventId ?? `${eventKey}:${JSON.stringify(value)}`,
    payload: value,
  }
}
