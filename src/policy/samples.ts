import type { PolicySample } from './types.js'

export interface PolicyEventSampleInput {
  readonly id: string
  readonly source: Readonly<Record<string, unknown>>
  readonly payload: Readonly<Record<string, unknown>>
}

export function eventToPolicySample(event: PolicyEventSampleInput): PolicySample {
  const text = typeof event.payload.text === 'string' && event.payload.text.length > 0
    ? event.payload.text
    : undefined
  const chatType = typeof event.payload.chatType === 'string' ? event.payload.chatType : undefined
  const external = typeof event.payload.external === 'boolean' ? event.payload.external : undefined
  const chatId = typeof event.source.conversationId === 'string' ? event.source.conversationId : undefined
  const senderId = typeof event.source.senderId === 'string' ? event.source.senderId : undefined
  const urgency = typeof event.payload.urgency === 'string' ? event.payload.urgency : undefined
  return {
    id: event.id,
    facts: {
      channel: {
        ...(chatType ? { chatType } : {}),
        ...(external !== undefined ? { external } : {}),
      },
      source: {
        ...(chatId ? { chatId } : {}),
        ...(senderId ? { senderId } : {}),
      },
      message: {
        ...(text ? { text, hasDeadline: /(今天|明天|本周|下周|截止|之前|\d{1,2}[月/-]\d{1,2})/.test(text) } : {}),
      },
      ...(urgency ? { urgency } : {}),
    },
  }
}
