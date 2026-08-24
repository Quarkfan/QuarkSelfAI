import { createHash } from 'node:crypto'
import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/runtime.js'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import { TASK_EFFECTS } from '../task-system/effects.js'
import { SESSION_EFFECTS, type SessionLifecycleConfig, type TrackResearchSessionInput } from './types.js'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Phase = 'waiting' | 'inspecting' | 'checking-task' | 'archiving' | 'archived' | 'deleting' | 'completed'
type Operation = 'inspect' | 'task-check' | 'archive' | 'delete'

interface FailureState {
  readonly operation: Operation
  readonly at: string
  readonly count: number
  readonly lastNotifiedAt?: string
}

export interface SessionLifecycleState extends Record<string, unknown> {
  readonly sessionId: string
  readonly taskId: string
  readonly eligible: boolean
  readonly phase: Phase
  readonly sequence: number
  readonly pollIntervalMs: number
  readonly retryBaseMs: number
  readonly retryMaxMs: number
  readonly deleteAfterMs: number
  readonly failureThreshold: number
  readonly failureNotifyCooldownMs: number
  readonly createdAt?: string
  readonly archivedAt?: string
  readonly deletedAt?: string
  readonly failure?: FailureState
}

function integer(value: number | undefined, fallback: number, label: string, minimum = 1): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < minimum) throw new Error(`${label} must be an integer of at least ${minimum}`)
  return selected
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a timestamp`)
  return value
}

function at(now: string, delayMs: number): string {
  return new Date(new Date(now).getTime() + delayMs).toISOString()
}

function effectId(state: SessionLifecycleState, operation: Operation): string {
  return `${operation}:${createHash('sha256').update(`${state.sessionId}\0${state.sequence}`).digest('hex').slice(0, 32)}`
}

function effectKind(event: WorkflowEvent): string | undefined {
  return typeof event.payload.effectKind === 'string' ? event.payload.effectKind : undefined
}

function withoutFailure(state: SessionLifecycleState): Omit<SessionLifecycleState, 'failure'> {
  const { failure: _failure, ...rest } = state
  return rest
}

function notification(state: SessionLifecycleState, suffix: string, title: string, body: string, now: string) {
  const id = `session-notification:${createHash('sha256').update(`${state.sessionId}\0${suffix}`).digest('hex').slice(0, 32)}`
  return { id, kind: ASSISTANT_EFFECTS.notifyOwner, availableAt: now, payload: { title, body, idempotencyKey: id } }
}

function retryDecision(state: SessionLifecycleState, operation: Operation, event: WorkflowEvent): WorkflowDecision {
  const prior = state.failure?.operation === operation ? state.failure : undefined
  const failure: FailureState = { operation, at: prior?.at ?? event.occurredAt, count: (prior?.count ?? 0) + 1,
    ...(prior?.lastNotifiedAt ? { lastNotifiedAt: prior.lastNotifiedAt } : {}) }
  const lastNotice = failure.lastNotifiedAt ? new Date(failure.lastNotifiedAt).getTime() : Number.NaN
  const shouldNotify = failure.count >= state.failureThreshold
    && (!Number.isFinite(lastNotice) || new Date(event.occurredAt).getTime() - lastNotice >= state.failureNotifyCooldownMs)
  const settledFailure = shouldNotify ? { ...failure, lastNotifiedAt: event.occurredAt } : failure
  const delay = Math.min(state.retryMaxMs, state.retryBaseMs * (2 ** Math.min(failure.count - 1, 10)))
  const phase: Phase = operation === 'delete' ? 'archived' : 'waiting'
  return {
    status: 'waiting', state: { ...state, phase, failure: settledFailure }, wakeAt: at(event.occurredAt, delay),
    ...(shouldNotify ? { effects: [notification(state, `failure:${operation}:${event.occurredAt}`,
      `Codex 自动调研会话${operation === 'delete' ? '删除' : '维护'}持续失败`,
      `会话：${state.sessionId}\n已连续失败 ${failure.count} 次，后台会按退避策略继续重试。`, event.occurredAt)] } : {}),
  }
}

export function sessionLifecycleWorkflow(config: SessionLifecycleConfig = {}): WorkflowDefinition {
  const pollIntervalMs = integer(config.pollIntervalMs, 6 * HOUR_MS, 'pollIntervalMs', 60_000)
  const retryBaseMs = integer(config.retryBaseMs, HOUR_MS, 'retryBaseMs', 1_000)
  const retryMaxMs = integer(config.retryMaxMs, DAY_MS, 'retryMaxMs', retryBaseMs)
  const deleteAfterDays = integer(config.deleteAfterDays, 7, 'deleteAfterDays')
  const failureThreshold = integer(config.failureNotifyThreshold, 1, 'failureNotifyThreshold')
  const failureNotifyCooldownMs = integer(config.failureNotifyCooldownMs, DAY_MS, 'failureNotifyCooldownMs', HOUR_MS)
  return {
    kind: 'codex.session-lifecycle', version: 1,
    initialize(rawInput, now) {
      const input = rawInput as unknown as TrackResearchSessionInput
      if (typeof input.sessionId !== 'string' || !UUID.test(input.sessionId)) throw new Error('sessionId must be an exact UUID')
      if (typeof input.taskId !== 'string' || !input.taskId.trim()) throw new Error('taskId must be a non-empty string')
      const createdAt = input.createdAt === undefined ? now : timestamp(input.createdAt, 'createdAt')
      const state: SessionLifecycleState = {
        sessionId: input.sessionId, taskId: input.taskId, eligible: input.eligible !== false, phase: 'waiting', sequence: 0,
        pollIntervalMs, retryBaseMs, retryMaxMs, deleteAfterMs: deleteAfterDays * DAY_MS,
        failureThreshold, failureNotifyCooldownMs, createdAt,
      }
      return { status: 'waiting', state, wakeAt: now }
    },
    reduce(rawState, event) {
      const state = rawState as SessionLifecycleState
      if (event.type === 'session.eligible') {
        if (state.phase !== 'waiting') throw new Error(`session eligibility cannot change during ${state.phase}`)
        return { status: 'waiting', state: { ...state, eligible: true }, wakeAt: event.occurredAt }
      }
      if (event.type === 'timer' && state.phase === 'waiting') {
        if (!state.eligible) return { status: 'waiting', state, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
        const next = { ...state, phase: 'inspecting' as const, sequence: state.sequence + 1 }
        return { status: 'waiting', state: next, effects: [{ id: effectId(next, 'inspect'), kind: SESSION_EFFECTS.inspect,
          availableAt: event.occurredAt, payload: { sessionId: state.sessionId } }] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'inspecting' && effectKind(event) === SESSION_EFFECTS.inspect) {
        const exists = event.payload.exists
        const archived = event.payload.archived
        const running = event.payload.running
        if (typeof exists !== 'boolean' || typeof archived !== 'boolean' || typeof running !== 'boolean') throw new Error('session inspect result is invalid')
        if (running) return { status: 'waiting', state: { ...withoutFailure(state), phase: 'waiting' }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
        if (exists && archived) {
          const archivedAt = event.occurredAt
          return { status: 'waiting', state: { ...withoutFailure(state), phase: 'archived', archivedAt }, wakeAt: at(archivedAt, state.deleteAfterMs) }
        }
        const next = { ...withoutFailure(state), phase: 'checking-task' as const }
        return { status: 'waiting', state: next, effects: [{ id: effectId(state, 'task-check'), kind: TASK_EFFECTS.isCompleted,
          availableAt: event.occurredAt, payload: { taskId: state.taskId } }] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'checking-task' && effectKind(event) === TASK_EFFECTS.isCompleted) {
        if (typeof event.payload.completed !== 'boolean') throw new Error('task completion result is invalid')
        if (!event.payload.completed) return { status: 'waiting', state: { ...withoutFailure(state), phase: 'waiting' }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
        const next = { ...withoutFailure(state), phase: 'archiving' as const }
        return { status: 'waiting', state: next, effects: [{ id: effectId(state, 'archive'), kind: SESSION_EFFECTS.archiveIfNeeded,
          availableAt: event.occurredAt, payload: { sessionId: state.sessionId } }] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'archiving' && effectKind(event) === SESSION_EFFECTS.archiveIfNeeded) {
        const archivedAt = timestamp(event.payload.archivedAt, 'archive effect archivedAt')
        if (typeof event.payload.alreadyArchived !== 'boolean') throw new Error('archive effect alreadyArchived is invalid')
        const effects = event.payload.alreadyArchived ? [] : [notification(state, 'archived', '自动调研会话已归档',
          `会话：${state.sessionId}\n关联任务：${state.taskId}`, event.occurredAt)]
        return { status: 'waiting', state: { ...withoutFailure(state), phase: 'archived', archivedAt },
          wakeAt: at(archivedAt, state.deleteAfterMs), effects }
      }
      if (event.type === 'timer' && state.phase === 'archived') {
        const next = { ...state, phase: 'deleting' as const, sequence: state.sequence + 1 }
        return { status: 'waiting', state: next, effects: [{ id: effectId(next, 'delete'), kind: SESSION_EFFECTS.deleteIfArchived,
          availableAt: event.occurredAt, payload: { sessionId: state.sessionId } }] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'deleting' && effectKind(event) === SESSION_EFFECTS.deleteIfArchived) {
        const outcome = event.payload.outcome
        if (!['deleted', 'missing', 'not-archived', 'running'].includes(String(outcome))) throw new Error('delete effect outcome is invalid')
        if (outcome === 'deleted' || outcome === 'missing') {
          return { status: 'completed', state: { ...withoutFailure(state), phase: 'completed', deletedAt: event.occurredAt } }
        }
        return { status: 'waiting', state: { ...withoutFailure(state), phase: 'archived' }, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
      }
      if (event.type === 'effect.failed') {
        const operation = operationFor(effectKind(event), state.phase)
        if (operation) return retryDecision(state, operation, event)
      }
      return { status: state.phase === 'completed' ? 'completed' : 'waiting', state,
        ...(['waiting', 'archived'].includes(state.phase) ? { wakeAt: at(event.occurredAt, state.pollIntervalMs) } : {}) }
    },
  }
}

function operationFor(kind: string | undefined, phase: Phase): Operation | undefined {
  if (kind === SESSION_EFFECTS.inspect && phase === 'inspecting') return 'inspect'
  if (kind === TASK_EFFECTS.isCompleted && phase === 'checking-task') return 'task-check'
  if (kind === SESSION_EFFECTS.archiveIfNeeded && phase === 'archiving') return 'archive'
  if (kind === SESSION_EFFECTS.deleteIfArchived && phase === 'deleting') return 'delete'
  return undefined
}
