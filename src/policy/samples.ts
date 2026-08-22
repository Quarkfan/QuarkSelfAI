import type { PolicySample } from './types.js'

export interface PolicyEventSampleInput {
  readonly id: string
  readonly source: Readonly<Record<string, unknown>>
  readonly payload: Readonly<Record<string, unknown>>
}

function messageText(content: unknown): string | undefined {
  if (typeof content !== 'string' || !content) return undefined
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const text = (parsed as Record<string, unknown>).text
      if (typeof text === 'string') return text
    }
  } catch {
    return content
  }
  return content
}

export function eventToPolicySample(event: PolicyEventSampleInput): PolicySample {
  const text = messageText(event.payload.content)
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
