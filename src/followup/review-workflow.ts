import { createHash } from 'node:crypto'
import { TASK_REASONING_EFFECTS } from '../task-system/reasoning-effects.js'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/runtime.js'
import { FOLLOWUP_EFFECTS, type FollowupOutreachInput, type FollowupReminder, type FollowupReviewConfig, type FollowupUpdate } from './types.js'

const HOUR_MS = 3_600_000
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
export interface FollowupReviewState extends Record<string, unknown> { readonly timeZone: string; readonly scheduledHour: number; readonly pollIntervalMs: number; readonly phase: 'scheduled' | 'evaluating' | 'distributing'; readonly sequence: number; readonly lastCompletedDay?: string; readonly pending: readonly string[] }
function integer(value: number | undefined, fallback: number, label: string, minimum = 1) { const selected = value ?? fallback; if (!Number.isSafeInteger(selected) || selected < minimum) throw new Error(`${label} is invalid`); return selected }
function at(now: string, delay: number) { return new Date(new Date(now).getTime() + delay).toISOString() }
function slot(now: string, timeZone: string, hour: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, due: WEEKDAYS.has(parts.weekday ?? '') && Number(parts.hour) >= hour }
}
function stable(prefix: string, ...parts: readonly string[]) { return `${prefix}:${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}` }
function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function required(value: unknown, label: string) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value }
function optional(value: unknown) { return typeof value === 'string' && value ? value : undefined }
function updates(value: unknown): FollowupUpdate[] { if (!Array.isArray(value)) throw new Error('followup evaluation updates must be an array'); return value.map((raw, i) => { const x = record(raw); if (!x || !Array.isArray(x.changes) || !x.changes.every(v => typeof v === 'string')) throw new Error(`invalid followup update ${i}`); const url = optional(x.url); return { taskId: required(x.taskId, 'taskId'), title: required(x.title, 'title'), changes: x.changes, reason: required(x.reason, 'reason'), ...(url ? { url } : {}) } }) }
function reminders(value: unknown): FollowupReminder[] { if (!Array.isArray(value)) throw new Error('followup evaluation reminders must be an array'); return value.map((raw, i) => { const x = record(raw); if (!x || !['low', 'medium', 'high'].includes(String(x.urgency))) throw new Error(`invalid followup reminder ${i}`); const url = optional(x.url); return { taskId: required(x.taskId, 'taskId'), title: required(x.title, 'title'), urgency: x.urgency as FollowupReminder['urgency'], reason: required(x.reason, 'reason'), recommendedAction: required(x.recommendedAction, 'recommendedAction'), ...(url ? { url } : {}) } }) }
function outreaches(value: unknown): FollowupOutreachInput[] { if (!Array.isArray(value)) throw new Error('followup evaluation outreachRequests must be an array'); return value.map((raw, i) => { const x = record(raw); if (!x) throw new Error(`invalid followup outreach ${i}`); const personName = optional(x.personName); const personOpenId = optional(x.personOpenId); const url = optional(x.url); return { taskId: required(x.taskId, 'taskId'), title: required(x.title, 'title'), ...(personName ? { personName } : {}), ...(personOpenId ? { personOpenId } : {}), question: required(x.question, 'question'), reason: required(x.reason, 'reason'), context: required(x.context, 'context'), ...(url ? { url } : {}) } }) }
function kind(event: WorkflowEvent) { return typeof event.payload.effectKind === 'string' ? event.payload.effectKind : undefined }
function effectId(event: WorkflowEvent) { return typeof event.payload.effectId === 'string' ? event.payload.effectId : undefined }

export function followupReviewWorkflow(config: FollowupReviewConfig = {}): WorkflowDefinition {
  const timeZone = config.timeZone ?? 'Asia/Shanghai'; const scheduledHour = integer(config.scheduledHour, 10, 'scheduledHour', 0); if (scheduledHour > 23) throw new Error('scheduledHour is invalid')
  const pollIntervalMs = integer(config.pollIntervalMs, HOUR_MS, 'pollIntervalMs', 60_000); slot(new Date().toISOString(), timeZone, scheduledHour)
  return { kind: 'followup.workday-review', version: 1,
    initialize(_input, now) { const state: FollowupReviewState = { timeZone, scheduledHour, pollIntervalMs, phase: 'scheduled', sequence: 0, pending: [] }; return { status: 'waiting', state, wakeAt: now } },
    reduce(raw, event): WorkflowDecision {
      const state = raw as FollowupReviewState
      if (event.type === 'timer' && state.phase === 'scheduled') {
        const current = slot(event.occurredAt, state.timeZone, state.scheduledHour)
        if (!current.due || state.lastCompletedDay === current.day) return { status: 'waiting', state, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
        const next = { ...state, phase: 'evaluating' as const, sequence: state.sequence + 1 }
        return { status: 'waiting', state: next, wakeAt: null, effects: [{ id: stable('followup-evaluate', current.day, String(next.sequence)), kind: TASK_REASONING_EFFECTS.evaluateFollowups, availableAt: event.occurredAt, payload: { day: current.day, timeZone: state.timeZone } }] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'evaluating' && kind(event) === TASK_REASONING_EFFECTS.evaluateFollowups) {
        const current = slot(event.occurredAt, state.timeZone, state.scheduledHour); const foundUpdates = updates(event.payload.updates); const foundReminders = reminders(event.payload.reminders); const foundOutreach = outreaches(event.payload.outreachRequests)
        const effects = []
        if (foundUpdates.length) { const id = stable('followup-updates', current.day); effects.push({ id, kind: ASSISTANT_EFFECTS.notifyOwner, availableAt: event.occurredAt, payload: { title: `已维护 ${foundUpdates.length} 项自动化跟进任务`, body: foundUpdates.map((x, i) => `${i + 1}. ${x.title}\n变更：${x.changes.join('；')}\n原因：${x.reason}${x.url ? `\n${x.url}` : ''}`).join('\n\n'), idempotencyKey: id } }) }
        if (foundReminders.length) { const id = stable('followup-reminders', current.day); effects.push({ id, kind: ASSISTANT_EFFECTS.notifyOwner, availableAt: event.occurredAt, payload: { title: `今天有 ${foundReminders.length} 项建议跟进`, body: foundReminders.map((x, i) => `${i + 1}. [${x.urgency}] ${x.title}\n原因：${x.reason}\n建议：${x.recommendedAction}${x.url ? `\n${x.url}` : ''}`).join('\n\n'), idempotencyKey: id } }) }
        for (const item of foundOutreach) { const id = stable('followup-open-outreach', item.taskId, item.personOpenId ?? item.personName ?? '', item.question); effects.push({ id, kind: FOLLOWUP_EFFECTS.openOutreach, availableAt: event.occurredAt, payload: { ...item, idempotencyKey: id } }) }
        if (!effects.length) return { status: 'waiting', state: { ...state, phase: 'scheduled', lastCompletedDay: current.day, pending: [] }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
        return { status: 'waiting', state: { ...state, phase: 'distributing', pending: effects.map(x => x.id) }, wakeAt: null, effects }
      }
      if (['effect.delivered', 'effect.failed'].includes(event.type) && state.phase === 'distributing') {
        const id = effectId(event); if (!id || !state.pending.includes(id)) return { status: 'waiting', state }
        const pending = state.pending.filter(value => value !== id); if (pending.length) return { status: 'waiting', state: { ...state, pending } }
        const current = slot(event.occurredAt, state.timeZone, state.scheduledHour)
        return { status: 'waiting', state: { ...state, phase: 'scheduled', lastCompletedDay: current.day, pending }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
      }
      if (event.type === 'effect.failed' && state.phase === 'evaluating' && kind(event) === TASK_REASONING_EFFECTS.evaluateFollowups) return { status: 'waiting', state: { ...state, phase: 'scheduled' }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
      return { status: 'waiting', state }
    } }
}
