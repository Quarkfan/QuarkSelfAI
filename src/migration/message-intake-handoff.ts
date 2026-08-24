import { createHash } from 'node:crypto'

export interface MessageIntakeHandoff {
  readonly counts: Readonly<Record<string, number>>
  readonly checkpoint: Readonly<Record<string, unknown>>
  readonly digest: string
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
  const digest = createHash('sha256').update(canonical(selected)).digest('hex')
  return {
    counts,
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

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
