const INTAKE = new Set(['information', 'task', 'followup'])
const ATTENTION = new Set(['silent', 'today', 'realtime'])
const TASK_ACTION = new Set(['created', 'updated', 'unchanged', 'ignored'])
const ACTUAL_NOTIFICATION = new Set(['silent', 'notify'])
const RECOMMENDED_NOTIFICATION = new Set(['silent', 'daily_digest', 'notify_now'])
const ACTION_OWNER = new Set(['changdongxu', 'shared', 'other', 'unknown'])
const TASK_PRIORITY = new Set([0, 1, 3, 5])

interface ShadowDecision {
  readonly messageId?: unknown
  readonly matterKey?: unknown
  readonly at?: unknown
  readonly intakeDecision?: unknown
  readonly attentionTier?: unknown
  readonly taskAction?: unknown
  readonly actualNotification?: unknown
  readonly recommendedNotification?: unknown
  readonly difference?: unknown
  readonly taskId?: unknown
  readonly title?: unknown
  readonly nextAction?: unknown
  readonly actionOwner?: unknown
  readonly actionRequired?: unknown
}

export interface ShadowAuditReport {
  readonly valid: boolean
  readonly windowComplete: boolean
  readonly readyForEvaluation: boolean
  readonly startedAt?: string
  readonly endsAt?: string
  readonly counts: {
    readonly decisions: number
    readonly matters: number
    readonly taskSnapshots: number
    readonly feedback: number
    readonly differences: number
    readonly taskMutations: number
    readonly sources: number
    readonly sourcesWithContext: number
    readonly uniqueChats: number
    readonly uniqueSenders: number
  }
  readonly distributions: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly blockers: readonly { readonly code: string; readonly count: number }[]
  readonly warnings: readonly { readonly code: string; readonly count: number }[]
  readonly rawBusinessContentEmitted: false
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function distribution(decisions: readonly ShadowDecision[], field: keyof ShadowDecision): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const decision of decisions) {
    const value = decision[field]
    const key = typeof value === 'string' && value ? value : '[missing]'
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

function valueDistribution(values: readonly unknown[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const value of values) {
    const key = nonEmptyString(value) ? value : '[missing]'
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function expectedRecommendation(tier: unknown): string | undefined {
  if (tier === 'realtime') return 'notify_now'
  if (tier === 'today') return 'daily_digest'
  if (tier === 'silent') return 'silent'
  return undefined
}

function expectedDifference(actual: unknown, tier: unknown): string | undefined {
  if (actual !== 'silent' && actual !== 'notify') return undefined
  if (actual === 'notify' && tier === 'silent') return 'possible_noise'
  if (actual === 'notify' && tier === 'today') return 'could_batch'
  if (actual === 'silent' && tier === 'realtime') return 'possible_miss'
  return 'aligned'
}

export function auditShadowState(state: Readonly<Record<string, unknown>>, now = new Date()): ShadowAuditReport {
  const mode = record(state.shadowMode)
  const decisions = Array.isArray(state.shadowDecisions) ? state.shadowDecisions as ShadowDecision[] : []
  const matters = Array.isArray(state.shadowMatters) ? state.shadowMatters : []
  const feedback = Array.isArray(state.shadowFeedback) ? state.shadowFeedback : []
  const snapshots = record(state.shadowTaskSnapshots) ?? {}
  const blockers = new Map<string, number>()
  const addBlocker = (code: string): void => {
    blockers.set(code, (blockers.get(code) ?? 0) + 1)
  }
  if (mode?.enabled !== true) addBlocker('shadow-not-enabled')
  const startedAt = validTimestamp(mode?.startedAt) ? mode.startedAt : undefined
  const endsAt = validTimestamp(mode?.endsAt) ? mode.endsAt : undefined
  if (!startedAt || !endsAt || Date.parse(startedAt) >= Date.parse(endsAt)) addBlocker('invalid-shadow-window')
  const messageIds = new Set<string>()
  for (const decision of decisions) {
    if (typeof decision.messageId !== 'string' || !decision.messageId) addBlocker('missing-message-id')
    else if (messageIds.has(decision.messageId)) addBlocker('duplicate-message-id')
    else messageIds.add(decision.messageId)
    if (typeof decision.matterKey !== 'string' || !decision.matterKey) addBlocker('missing-matter-key')
    if (!validTimestamp(decision.at)) addBlocker('invalid-decision-time')
    if (!INTAKE.has(String(decision.intakeDecision))) addBlocker('invalid-intake-decision')
    if (!ATTENTION.has(String(decision.attentionTier))) addBlocker('invalid-attention-tier')
    if (!TASK_ACTION.has(String(decision.taskAction))) addBlocker('invalid-task-action')
    if (!ACTUAL_NOTIFICATION.has(String(decision.actualNotification))) addBlocker('invalid-actual-notification')
    if (!RECOMMENDED_NOTIFICATION.has(String(decision.recommendedNotification))) addBlocker('invalid-recommended-notification')
    if (!ACTION_OWNER.has(String(decision.actionOwner))) addBlocker('invalid-action-owner')
    if (typeof decision.actionRequired !== 'boolean') addBlocker('invalid-action-required')
    if (!nonEmptyString(decision.title)) addBlocker('missing-decision-title')
    if (decision.recommendedNotification !== expectedRecommendation(decision.attentionTier)) {
      addBlocker('attention-notification-mismatch')
    }
    if (decision.difference !== expectedDifference(decision.actualNotification, decision.attentionTier)) {
      addBlocker('notification-difference-mismatch')
    }
    if (decision.taskAction === 'created') {
      if (!nonEmptyString(decision.taskId)) addBlocker('created-task-missing-id')
      if (decision.intakeDecision !== 'task') addBlocker('created-task-invalid-intake')
      if (decision.actionRequired !== true) addBlocker('created-task-no-action')
      if (decision.actionOwner !== 'changdongxu' && decision.actionOwner !== 'shared') addBlocker('created-task-invalid-owner')
      if (!nonEmptyString(decision.nextAction)) addBlocker('created-task-missing-next-action')
    }
    if ((decision.taskAction === 'updated' || decision.taskAction === 'unchanged') && !nonEmptyString(decision.taskId)) {
      addBlocker('existing-task-missing-id')
    }
    if (decision.taskAction === 'created' && decision.intakeDecision !== 'task') addBlocker('non-task-created')
  }
  const matterKeys = new Set<string>()
  const sourceMessageIds = new Set<string>()
  const chatIds = new Set<string>()
  const senderIds = new Set<string>()
  const intakeReasons: string[] = []
  let sourceCount = 0
  let sourcesWithContext = 0
  for (const value of matters) {
    const matter = record(value)
    const key = matter?.key
    if (!nonEmptyString(key)) addBlocker('missing-shadow-matter-key')
    else if (matterKeys.has(key)) addBlocker('duplicate-shadow-matter-key')
    else matterKeys.add(key)
    if (!Array.isArray(matter?.sources)) {
      addBlocker('missing-shadow-matter-sources')
      continue
    }
    for (const sourceValue of matter.sources) {
      sourceCount += 1
      const source = record(sourceValue)
      if (!source || !nonEmptyString(source.messageId)) addBlocker('invalid-shadow-source-message')
      else if (sourceMessageIds.has(source.messageId)) addBlocker('duplicate-shadow-source-message')
      else sourceMessageIds.add(source.messageId)
      if (!nonEmptyString(source?.chatId)) addBlocker('invalid-shadow-source-chat')
      else chatIds.add(source.chatId)
      if (nonEmptyString(source?.senderId)) senderIds.add(source.senderId)
      if (!Number.isSafeInteger(source?.contextCount) || Number(source?.contextCount) < 0) {
        addBlocker('invalid-shadow-source-context-count')
      } else if (Number(source?.contextCount) > 0) {
        sourcesWithContext += 1
      }
      if (!Array.isArray(source?.intakeReasons) || source.intakeReasons.length === 0
        || source.intakeReasons.some((reason) => !nonEmptyString(reason))) {
        addBlocker('invalid-shadow-source-intake-reasons')
      } else {
        intakeReasons.push(...source.intakeReasons as string[])
      }
    }
  }
  for (const decision of decisions) {
    if (nonEmptyString(decision.matterKey) && !matterKeys.has(decision.matterKey)) addBlocker('missing-shadow-matter-reference')
    if (nonEmptyString(decision.messageId) && !sourceMessageIds.has(decision.messageId)) addBlocker('missing-shadow-source-reference')
  }
  for (const value of Object.values(snapshots)) {
    const snapshot = record(value)
    if (!snapshot) {
      addBlocker('invalid-task-snapshot')
      continue
    }
    if (!nonEmptyString(snapshot.projectId)) addBlocker('task-snapshot-missing-project')
    if (!nonEmptyString(snapshot.title)) addBlocker('task-snapshot-missing-title')
    if (snapshot.status !== 0 && snapshot.status !== 2) addBlocker('task-snapshot-invalid-status')
    if (!TASK_PRIORITY.has(Number(snapshot.priority))) addBlocker('task-snapshot-invalid-priority')
    if (!Number.isSafeInteger(snapshot.missingCount) || Number(snapshot.missingCount) < 0) addBlocker('task-snapshot-invalid-missing-count')
  }
  for (const value of feedback) {
    const item = record(value)
    if (!item || !validTimestamp(item.at)) addBlocker('invalid-shadow-feedback-time')
    if (!nonEmptyString(item?.taskId) || !nonEmptyString(item?.type)) addBlocker('invalid-shadow-feedback-reference')
  }
  const windowComplete = endsAt !== undefined && now.getTime() >= Date.parse(endsAt)
  const warnings: Array<{ code: string; count: number }> = []
  if (!windowComplete) warnings.push({ code: 'shadow-window-in-progress', count: 1 })
  if (decisions.length < 20) warnings.push({ code: 'insufficient-shadow-decisions', count: 20 - decisions.length })
  const blockerList = [...blockers].map(([code, count]) => ({ code, count }))
  return {
    valid: blockerList.length === 0,
    windowComplete,
    readyForEvaluation: blockerList.length === 0 && windowComplete && decisions.length >= 20,
    ...(startedAt ? { startedAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    counts: {
      decisions: decisions.length,
      matters: matters.length,
      taskSnapshots: Object.keys(snapshots).length,
      feedback: feedback.length,
      differences: decisions.filter((decision) => typeof decision.difference === 'string' && decision.difference !== 'aligned').length,
      taskMutations: decisions.filter((decision) => decision.taskAction === 'created' || decision.taskAction === 'updated').length,
      sources: sourceCount,
      sourcesWithContext,
      uniqueChats: chatIds.size,
      uniqueSenders: senderIds.size,
    },
    distributions: {
      intakeDecision: distribution(decisions, 'intakeDecision'),
      attentionTier: distribution(decisions, 'attentionTier'),
      taskAction: distribution(decisions, 'taskAction'),
      actualNotification: distribution(decisions, 'actualNotification'),
      recommendedNotification: distribution(decisions, 'recommendedNotification'),
      intakeReason: valueDistribution(intakeReasons),
    },
    blockers: blockerList,
    warnings,
    rawBusinessContentEmitted: false,
  }
}
