import type { TaskProjectionTarget } from '../task-system/projection-effects.js'

export const FOLLOWUP_EFFECTS = { openOutreach: 'followup.open-outreach.v1' } as const
export interface FollowupReviewConfig {
  readonly enabled?: boolean
  readonly projectId?: string
  readonly taskProjection?: TaskProjectionTarget
  readonly timeZone?: string
  readonly scheduledHour?: number
  readonly pollIntervalMs?: number
}
export interface FollowupReminder { readonly taskId: string; readonly title: string; readonly urgency: 'low' | 'medium' | 'high'; readonly reason: string; readonly recommendedAction: string; readonly url?: string }
export interface FollowupUpdate { readonly taskId: string; readonly title: string; readonly summary: string; readonly changes: readonly string[]; readonly reason: string; readonly priority?: 0 | 1 | 3 | 5; readonly tags?: readonly string[]; readonly dueDate?: string; readonly url?: string }
export interface FollowupOutreachInput extends Readonly<Record<string, unknown>> { readonly taskId: string; readonly title: string; readonly personName?: string; readonly personOpenId?: string; readonly question: string; readonly reason: string; readonly context: string; readonly url?: string }
export interface FollowupContact { readonly openId: string; readonly name: string; readonly department?: string; readonly email?: string; readonly external: boolean }
export interface FollowupOutreachConfig { readonly enabled?: boolean; readonly retryBaseMs?: number; readonly retryMaxMs?: number; readonly failureNotifyThreshold?: number; readonly taskProjection?: TaskProjectionTarget }
export interface FollowupReplyInput { readonly messageId: string; readonly content: string; readonly receivedAt: string; readonly url?: string }

export interface FollowupEvaluation {
  readonly updates: readonly FollowupUpdate[]
  readonly reminders: readonly FollowupReminder[]
  readonly outreachRequests: readonly FollowupOutreachInput[]
}

export function validateFollowupEvaluation(value: unknown): FollowupEvaluation {
  const root = record(value, 'followup evaluation')
  return {
    updates: array(root.updates, 'updates').map(validateFollowupUpdate),
    reminders: array(root.reminders, 'reminders').map((value, index) => {
      const item = record(value, `reminder ${index}`)
      if (!['low', 'medium', 'high'].includes(String(item.urgency))) throw new Error(`invalid followup reminder ${index}`)
      const url = optional(item.url, 2_000)
      return { taskId: text(item.taskId, 'reminder taskId', 300), title: text(item.title, 'reminder title', 500), urgency: item.urgency as FollowupReminder['urgency'], reason: text(item.reason, 'reminder reason', 2_000), recommendedAction: text(item.recommendedAction, 'recommendedAction', 2_000), ...(url ? { url } : {}) }
    }),
    outreachRequests: array(root.outreachRequests, 'outreachRequests').map((value, index) => {
      const item = record(value, `outreach ${index}`); const personName = optional(item.personName, 300); const personOpenId = optional(item.personOpenId, 300); if (!personName && !personOpenId) throw new Error(`outreach ${index} requires a person`); const url = optional(item.url, 2_000)
      return { taskId: text(item.taskId, 'outreach taskId', 300), title: text(item.title, 'outreach title', 500), ...(personName ? { personName } : {}), ...(personOpenId ? { personOpenId } : {}), question: text(item.question, 'outreach question', 2_000), reason: text(item.reason, 'outreach reason', 2_000), context: text(item.context, 'outreach context', 5_000), ...(url ? { url } : {}) }
    }),
  }
}

export function validateFollowupUpdate(value: unknown, index = 0): FollowupUpdate {
  const item = record(value, `update ${index}`)
  const changes = array(item.changes, `update ${index} changes`).map((change, changeIndex) => text(change, `update ${index} change ${changeIndex}`, 500))
  if (!changes.length) throw new Error(`update ${index} must describe a real change`)
  const priority = item.priority === undefined ? undefined : Number(item.priority)
  if (priority !== undefined && ![0, 1, 3, 5].includes(priority)) throw new Error(`update ${index} priority is invalid`)
  const tags = item.tags === undefined ? undefined : array(item.tags, `update ${index} tags`).map((tag, tagIndex) => text(tag, `update ${index} tag ${tagIndex}`, 100))
  if (tags && new Set(tags).size !== tags.length) throw new Error(`update ${index} tags must be unique`)
  const dueDate = optional(item.dueDate, 100); if (dueDate && Number.isNaN(new Date(dueDate).getTime())) throw new Error(`update ${index} dueDate is invalid`)
  const url = optional(item.url, 2_000)
  return { taskId: text(item.taskId, 'update taskId', 300), title: text(item.title, 'update title', 500), summary: text(item.summary, 'update summary', 1_000), changes, reason: text(item.reason, 'update reason', 2_000), ...(priority !== undefined ? { priority: priority as 0 | 1 | 3 | 5 } : {}), ...(tags ? { tags } : {}), ...(dueDate ? { dueDate } : {}), ...(url ? { url } : {}) }
}

function record(value: unknown, label: string): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown> }
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value }
function text(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); if (value.length > max) throw new Error(`${label} exceeds ${max} characters`); return value }
function optional(value: unknown, max: number): string | undefined { return value === undefined || value === null || value === '' ? undefined : text(value, 'optional text', max) }
