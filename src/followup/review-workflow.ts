import { createHash } from 'node:crypto'
import { TASK_REASONING_EFFECTS } from '../task-system/reasoning-effects.js'
import { TASK_STORE_EFFECTS } from '../task-system/store-effects.js'
import { TASK_PROJECTION_EFFECTS, type TaskProjectionTarget } from '../task-system/projection-effects.js'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/contracts.js'
import { FOLLOWUP_EFFECTS, validateFollowupEvaluation, type FollowupEvaluation, type FollowupReviewConfig } from './types.js'

const HOUR_MS = 3_600_000
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
export interface FollowupReviewState extends Record<string, unknown> { readonly projectId: string; readonly taskProjection: TaskProjectionTarget; readonly timeZone: string; readonly scheduledHour: number; readonly pollIntervalMs: number; readonly phase: 'scheduled' | 'loading' | 'evaluating' | 'applying' | 'distributing'; readonly sequence: number; readonly lastCompletedDay?: string; readonly pending: readonly string[]; readonly evaluation?: FollowupEvaluation }
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
function kind(event: WorkflowEvent) { return typeof event.payload.effectKind === 'string' ? event.payload.effectKind : undefined }
function effectId(event: WorkflowEvent) { return typeof event.payload.effectId === 'string' ? event.payload.effectId : undefined }

export function followupReviewWorkflow(config: FollowupReviewConfig = {}): WorkflowDefinition {
  const projectId = required(config.projectId, 'followup projectId'); if (!config.taskProjection || config.taskProjection.projectId !== projectId) throw new Error('followup review requires matching task projection authorization')
  const timeZone = config.timeZone ?? 'Asia/Shanghai'; const scheduledHour = integer(config.scheduledHour, 10, 'scheduledHour', 0); if (scheduledHour > 23) throw new Error('scheduledHour is invalid')
  const pollIntervalMs = integer(config.pollIntervalMs, HOUR_MS, 'pollIntervalMs', 60_000); slot(new Date().toISOString(), timeZone, scheduledHour)
  return { kind: 'followup.workday-review', version: 1,
    initialize(_input, now) { const state: FollowupReviewState = { projectId, taskProjection: config.taskProjection!, timeZone, scheduledHour, pollIntervalMs, phase: 'scheduled', sequence: 0, pending: [] }; return { status: 'waiting', state, wakeAt: now } },
    reduce(raw, event): WorkflowDecision {
      const state = raw as FollowupReviewState
      if (event.type === 'timer' && state.phase === 'scheduled') {
        const current = slot(event.occurredAt, state.timeZone, state.scheduledHour)
        if (!current.due || state.lastCompletedDay === current.day) return { status: 'waiting', state, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
        const next = { ...state, phase: 'loading' as const, sequence: state.sequence + 1 }
        return { status: 'waiting', state: next, wakeAt: null, effects: [{ id: stable('followup-list-active', current.day, String(next.sequence)), kind: TASK_STORE_EFFECTS.listActive, availableAt: event.occurredAt, payload: { projectId: state.projectId } }] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'loading' && kind(event) === TASK_STORE_EFFECTS.listActive) {
        if (event.payload.projectId !== state.projectId || !Array.isArray(event.payload.tasks)) throw new Error('followup task snapshot is invalid')
        const current = slot(event.occurredAt, state.timeZone, state.scheduledHour); const id = stable('followup-evaluate', current.day, String(state.sequence))
        return { status: 'waiting', state: { ...state, phase: 'evaluating' }, wakeAt: null, effects: [{ id, kind: TASK_REASONING_EFFECTS.evaluateFollowups, availableAt: event.occurredAt, payload: { day: current.day, timeZone: state.timeZone, tasks: event.payload.tasks } }] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'evaluating' && kind(event) === TASK_REASONING_EFFECTS.evaluateFollowups) {
        const evaluation = validateFollowupEvaluation(event.payload)
        if (!evaluation.updates.length) return distribute(state, evaluation, event.occurredAt)
        const effects = evaluation.updates.map(item => ({ id: stable('followup-apply-update', item.taskId, slot(event.occurredAt, state.timeZone, state.scheduledHour).day), kind: TASK_PROJECTION_EFFECTS.applyFollowupUpdate, availableAt: event.occurredAt, payload: { projectId: state.projectId, authorization: state.taskProjection.authorization, effectiveAt: event.occurredAt, update: item, idempotencyKey: `followup-review:${slot(event.occurredAt, state.timeZone, state.scheduledHour).day}:${item.taskId}` } }))
        return { status: 'waiting', state: { ...state, phase: 'applying', evaluation, pending: effects.map(item => item.id) }, wakeAt: null, effects }
      }
      if (event.type === 'effect.delivered' && state.phase === 'applying' && kind(event) === TASK_PROJECTION_EFFECTS.applyFollowupUpdate) {
        const id = effectId(event); if (!id || !state.pending.includes(id)) return { status: 'waiting', state }
        const pending = state.pending.filter(value => value !== id); if (pending.length) return { status: 'waiting', state: { ...state, pending } }
        return distribute({ ...state, pending: [] }, state.evaluation!, event.occurredAt)
      }
      if (['effect.delivered', 'effect.failed'].includes(event.type) && state.phase === 'distributing') {
        const id = effectId(event); if (!id || !state.pending.includes(id)) return { status: 'waiting', state }
        const pending = state.pending.filter(value => value !== id); if (pending.length) return { status: 'waiting', state: { ...state, pending } }
        const current = slot(event.occurredAt, state.timeZone, state.scheduledHour)
        return { status: 'waiting', state: { ...withoutEvaluation(state), phase: 'scheduled', lastCompletedDay: current.day, pending }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
      }
      if (event.type === 'effect.failed' && ['loading', 'evaluating', 'applying'].includes(state.phase)) return { status: 'waiting', state: { ...state, phase: 'scheduled', pending: [] }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
      return { status: 'waiting', state }
    } }
}

function distribute(state: FollowupReviewState, evaluation: FollowupEvaluation, now: string): WorkflowDecision {
  const current = slot(now, state.timeZone, state.scheduledHour); const effects = []
  if (evaluation.updates.length) { const id = stable('followup-updates', current.day); effects.push({ id, kind: ASSISTANT_EFFECTS.notifyOwner, availableAt: now, payload: { title: `已维护 ${evaluation.updates.length} 项自动化跟进任务`, body: evaluation.updates.map((x, i) => `${i + 1}. ${x.title}\n变更：${x.changes.join('；')}\n原因：${x.reason}${x.url ? `\n${x.url}` : ''}`).join('\n\n'), idempotencyKey: id } }) }
  if (evaluation.reminders.length) { const id = stable('followup-reminders', current.day); effects.push({ id, kind: ASSISTANT_EFFECTS.notifyOwner, availableAt: now, payload: { title: `今天有 ${evaluation.reminders.length} 项建议跟进`, body: evaluation.reminders.map((x, i) => `${i + 1}. [${x.urgency}] ${x.title}\n原因：${x.reason}\n建议：${x.recommendedAction}${x.url ? `\n${x.url}` : ''}`).join('\n\n'), idempotencyKey: id } }) }
  for (const item of evaluation.outreachRequests) { const id = stable('followup-open-outreach', item.taskId, item.personOpenId ?? item.personName ?? '', item.question); effects.push({ id, kind: FOLLOWUP_EFFECTS.openOutreach, availableAt: now, payload: { ...item, idempotencyKey: id } }) }
  if (!effects.length) return { status: 'waiting', state: { ...withoutEvaluation(state), phase: 'scheduled', lastCompletedDay: current.day, pending: [] }, wakeAt: at(now, state.pollIntervalMs) }
  return { status: 'waiting', state: { ...state, phase: 'distributing', pending: effects.map(item => item.id) }, wakeAt: null, effects }
}

function withoutEvaluation(state: FollowupReviewState): Omit<FollowupReviewState, 'evaluation'> { const { evaluation: _evaluation, ...rest } = state; return rest }
