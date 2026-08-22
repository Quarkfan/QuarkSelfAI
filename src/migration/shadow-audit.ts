const INTAKE = new Set(['information', 'task', 'followup'])
const ATTENTION = new Set(['silent', 'today', 'realtime'])
const TASK_ACTION = new Set(['created', 'updated', 'unchanged', 'ignored'])
const NOTIFICATION = new Set(['silent', 'daily_digest', 'notify_now', 'notify'])

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
    if (!NOTIFICATION.has(String(decision.actualNotification))) addBlocker('invalid-actual-notification')
    if (!NOTIFICATION.has(String(decision.recommendedNotification))) addBlocker('invalid-recommended-notification')
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
      differences: decisions.filter((decision) => typeof decision.difference === 'string' && decision.difference.length > 0).length,
    },
    distributions: {
      intakeDecision: distribution(decisions, 'intakeDecision'),
      attentionTier: distribution(decisions, 'attentionTier'),
      taskAction: distribution(decisions, 'taskAction'),
      actualNotification: distribution(decisions, 'actualNotification'),
      recommendedNotification: distribution(decisions, 'recommendedNotification'),
    },
    blockers: blockerList,
    warnings,
    rawBusinessContentEmitted: false,
  }
}
