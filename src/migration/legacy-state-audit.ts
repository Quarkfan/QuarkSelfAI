export interface LegacyStateAuditReport {
  readonly handoffSafe: boolean
  readonly blockers: readonly { code: string; count: number }[]
  readonly warnings: readonly { code: string; count: number }[]
  readonly transferableWork: Readonly<Record<string, number>>
  readonly counts: Readonly<Record<string, number>>
  readonly duplicateIds: Readonly<Record<string, number>>
  readonly invalidTimestampFields: number
  readonly invalidOperationalTimestampFields: number
  readonly invalidTimestampPaths: readonly string[]
  readonly rawBusinessContentEmitted: false
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
}

function duplicateCount(values: readonly unknown[]): number {
  const normalized = values.filter((value): value is string => typeof value === 'string' && value.length > 0)
  return normalized.length - new Set(normalized).size
}

function activeFailure(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0
}

export function auditLegacyState(state: Record<string, unknown>): LegacyStateAuditReport {
  const queue = records(state.queue)
  const mentionPending = records(state.mentionPending)
  const researchPending = records(state.mentionResearchConfirmations).filter((item) => item.status === 'pending')
  const xiaoweiPending = records(state.xiaoweiResearchRequests).filter((item) => !['completed', 'failed', 'cancelled'].includes(String(item.status)))
  const outreachPending = records(state.followupOutreachRequests).filter((item) => !['completed', 'declined', 'cancelled'].includes(String(item.status)))
  const failureFields = [
    'mentionHealthFailure', 'mentionRateLimitFailure', 'flaggedConversationHealthFailure',
    'cardActionHealthFailure', 'overdueHealthFailure', 'didaCompletedCleanupHealthFailure',
    'followupHealthFailure', 'xiaoweiHealthFailure',
  ]
  const activeFailures = failureFields.filter((field) => activeFailure(state[field]))
  const malformedQueue = queue.filter((item) => !['id', 'sessionId', 'prompt'].every((key) => typeof item[key] === 'string' && item[key]))
  const duplicateIds = {
    processedOwnerMessages: duplicateCount(Array.isArray(state.processedMessageIds) ? state.processedMessageIds : []),
    processedFocusMessages: duplicateCount(Array.isArray(state.mentionProcessedMessageIds) ? state.mentionProcessedMessageIds : []),
    processedCardEvents: duplicateCount(Array.isArray(state.processedCardEventIds) ? state.processedCardEventIds : []),
    queuedJobs: duplicateCount(queue.map((item) => item.id)),
  }
  const blockers = [
    ['malformed-queued-job', malformedQueue.length],
    ['duplicate-state-id', Object.values(duplicateIds).reduce((sum, count) => sum + count, 0)],
  ].filter((entry): entry is [string, number] => Number(entry[1]) > 0).map(([code, count]) => ({ code, count }))
  const warnings: { code: string; count: number }[] = activeFailures.length > 0 ? [{ code: 'active-health-failure', count: activeFailures.length }] : []

  let invalidTimestampFields = 0
  let invalidOperationalTimestampFields = 0
  let invalidBusinessDueDates = 0
  const invalidTimestampPaths: string[] = []
  const inspectTimestamps = (value: unknown, path: readonly string[] = []): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspectTimestamps(item, [...path, String(index)]))
      return
    }
    if (typeof value !== 'object' || value === null) return
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/(?:At|Date)$/.test(key) && typeof item === 'string' && item && Number.isNaN(new Date(item).getTime())) {
        invalidTimestampFields += 1
        if (key === 'dueDate') invalidBusinessDueDates += 1
        else invalidOperationalTimestampFields += 1
        invalidTimestampPaths.push([...path, key].join('.'))
      } else inspectTimestamps(item, [...path, key])
    }
  }
  inspectTimestamps(state)
  if (invalidOperationalTimestampFields > 0) blockers.push({ code: 'invalid-operational-timestamp', count: invalidOperationalTimestampFields })
  if (invalidBusinessDueDates > 0) warnings.push({ code: 'invalid-business-due-date', count: invalidBusinessDueDates })

  return {
    handoffSafe: blockers.length === 0,
    blockers,
    warnings,
    transferableWork: {
      queuedControllerWork: queue.length,
      pendingFocusMessages: mentionPending.length,
      pendingResearchConfirmations: researchPending.length,
      pendingXiaoweiRequests: xiaoweiPending.length,
      pendingFollowupOutreach: outreachPending.length,
    },
    counts: {
      queue: queue.length,
      processedOwnerMessages: Array.isArray(state.processedMessageIds) ? state.processedMessageIds.length : 0,
      processedFocusMessages: Array.isArray(state.mentionProcessedMessageIds) ? state.mentionProcessedMessageIds.length : 0,
      processedCardEvents: Array.isArray(state.processedCardEventIds) ? state.processedCardEventIds.length : 0,
      trackedResearchSessions: records(state.mentionResearchSessions).length,
      researchDecisionHistory: records(state.researchDecisionHistory).length,
      shadowMatters: records(state.shadowMatters).length,
    },
    duplicateIds,
    invalidTimestampFields,
    invalidOperationalTimestampFields,
    invalidTimestampPaths,
    rawBusinessContentEmitted: false,
  }
}
