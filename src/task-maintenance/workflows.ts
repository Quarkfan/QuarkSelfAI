import { createHash } from 'node:crypto'
import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/runtime.js'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import { TASK_STORE_EFFECTS } from '../task-system/store-effects.js'
import { TASK_MAINTENANCE_EFFECTS } from '../task-system/maintenance-effects.js'
import type { DeletedTask, DidaMaintenanceConfig, OverdueTask } from './types.js'
import { requireAuthorizationEvidence } from '../domain/authorization.js'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

interface FailureState {
  readonly at: string
  readonly count: number
  readonly notified: boolean
}

interface OverdueState extends Record<string, unknown> {
  readonly projectId: string
  readonly intervalMs: number
  readonly retryMs: number
  readonly failureThreshold: number
  readonly phase: 'scheduled' | 'scanning'
  readonly notified: Readonly<Record<string, { readonly fingerprint: string; readonly at: string }>>
  readonly failure?: FailureState
}

interface CleanupState extends Record<string, unknown> {
  readonly projectId: string
  readonly timeZone: string
  readonly scheduledHour: number
  readonly pollIntervalMs: number
  readonly retentionDays: number
  readonly maxPerRun: number
  readonly failureThreshold: number
  readonly authorization: NonNullable<DidaMaintenanceConfig['cleanupAuthorization']>
  readonly phase: 'scheduled' | 'cleaning'
  readonly pendingDay?: string
  readonly lastCompletedDay?: string
  readonly failure?: FailureState
}

function positiveInteger(value: number | undefined, fallback: number, label: string, minimum = 1): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < minimum) throw new Error(`${label} must be an integer of at least ${minimum}`)
  return selected
}

function at(now: string, delayMs: number): string {
  return new Date(new Date(now).getTime() + delayMs).toISOString()
}

function id(prefix: string, ...values: readonly string[]): string {
  return `${prefix}:${createHash('sha256').update(values.join('\0')).digest('hex').slice(0, 32)}`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}

function localSlot(now: string, timeZone: string, scheduledHour: number): { readonly day: string; readonly due: boolean } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, due: Number(parts.hour) >= scheduledHour }
}

function notificationEffect(effectId: string, title: string, body: string, availableAt: string) {
  return { id: effectId, kind: ASSISTANT_EFFECTS.notifyOwner, availableAt, payload: { title, body, idempotencyKey: effectId } }
}

function effectKind(event: WorkflowEvent): string | undefined {
  return typeof event.payload.effectKind === 'string' ? event.payload.effectKind : undefined
}

function failure(state: FailureState | undefined, now: string): FailureState {
  return { at: state?.at ?? now, count: (state?.count ?? 0) + 1, notified: state?.notified ?? false }
}

export function overdueWorkflow(config: DidaMaintenanceConfig): WorkflowDefinition {
  const projectId = string(config.projectId, 'Dida maintenance projectId')
  const intervalMs = positiveInteger(config.overdueIntervalMs, 30 * MINUTE_MS, 'overdueIntervalMs', MINUTE_MS)
  const retryMs = positiveInteger(config.overdueRetryMs, 10 * MINUTE_MS, 'overdueRetryMs', MINUTE_MS)
  const failureThreshold = positiveInteger(config.failureNotifyThreshold, 3, 'failureNotifyThreshold')
  return {
    kind: 'dida.overdue-monitor', version: 1,
    initialize(_input, now): WorkflowDecision {
      const state: OverdueState = { projectId, intervalMs, retryMs, failureThreshold, phase: 'scheduled', notified: {} }
      return { status: 'waiting', state, wakeAt: now }
    },
    reduce(rawState, event): WorkflowDecision {
      const state = rawState as OverdueState
      if (event.type === 'timer' && state.phase === 'scheduled') {
        const scanId = id('dida-overdue-scan', state.projectId, String(event.payload.scheduledAt ?? event.occurredAt))
        return {
          status: 'waiting', state: { ...state, phase: 'scanning' },
          wakeAt: null,
          effects: [{ id: scanId, kind: TASK_STORE_EFFECTS.listOverdue, availableAt: event.occurredAt, payload: { projectId: state.projectId } }],
        }
      }
      if (['effect.delivered', 'effect.failed'].includes(event.type) && effectKind(event) === ASSISTANT_EFFECTS.notifyOwner) return { status: 'waiting', state }
      if (event.type === 'effect.delivered' && effectKind(event) === TASK_STORE_EFFECTS.listOverdue) {
        const tasks = parseOverdueTasks(event.payload.tasks)
        const nextNotified = { ...state.notified }
        const effects = []
        for (const task of tasks) {
          const fingerprint = `${task.dueDate}:${task.priority}`
          if (nextNotified[task.taskId]?.fingerprint === fingerprint) continue
          const effectId = id('dida-overdue-notification', task.taskId, fingerprint)
          effects.push(notificationEffect(effectId, `自动化待办已超期：${task.title}`,
            `截止：${task.dueDate}\n优先级：${task.priority}${task.url ? `\n${task.url}` : ''}`, event.occurredAt))
          nextNotified[task.taskId] = { fingerprint, at: event.occurredAt }
        }
        if (state.failure?.notified) {
          effects.push(notificationEffect(id('dida-overdue-recovered', state.failure.at), '滴答清单超期监控已恢复',
            `故障始于：${state.failure.at}`, event.occurredAt))
        }
        const { failure: _failure, ...withoutFailure } = state
        return {
          status: 'waiting', state: { ...withoutFailure, phase: 'scheduled', notified: pruneFingerprints(nextNotified, event.occurredAt) },
          wakeAt: at(event.occurredAt, state.intervalMs), effects,
        }
      }
      if (event.type === 'effect.failed' && effectKind(event) === TASK_STORE_EFFECTS.listOverdue) {
        const nextFailure = failure(state.failure, event.occurredAt)
        const shouldNotify = !nextFailure.notified && nextFailure.count >= state.failureThreshold
        return {
          status: 'waiting',
          state: { ...state, phase: 'scheduled', failure: { ...nextFailure, notified: nextFailure.notified || shouldNotify } },
          wakeAt: at(event.occurredAt, state.retryMs),
          ...(shouldNotify ? { effects: [notificationEffect(id('dida-overdue-failed', nextFailure.at),
            '滴答清单超期监控持续失败', `已连续失败 ${nextFailure.count} 次，后台会继续重试。`, event.occurredAt)] } : {}),
        }
      }
      return { status: 'waiting', state, ...(state.phase === 'scheduled' ? { wakeAt: at(event.occurredAt, state.intervalMs) } : {}) }
    },
  }
}

export function completedCleanupWorkflow(config: DidaMaintenanceConfig): WorkflowDefinition {
  const projectId = string(config.projectId, 'Dida maintenance projectId')
  const timeZone = config.cleanupTimeZone ?? 'Asia/Shanghai'
  const scheduledHour = positiveInteger(config.cleanupHour, 3, 'cleanupHour', 0)
  if (scheduledHour > 23) throw new Error('cleanupHour must be at most 23')
  const pollIntervalMs = positiveInteger(config.cleanupPollIntervalMs, 30 * MINUTE_MS, 'cleanupPollIntervalMs', MINUTE_MS)
  const retentionDays = positiveInteger(config.completedRetentionDays, 30, 'completedRetentionDays')
  const maxPerRun = positiveInteger(config.cleanupMaxPerRun, 50, 'cleanupMaxPerRun')
  const failureThreshold = positiveInteger(config.cleanupFailureNotifyThreshold, 3, 'cleanupFailureNotifyThreshold')
  const authorization = cleanupAuthorization(config, projectId, retentionDays, maxPerRun)
  // Validate the timezone eagerly.
  localSlot(new Date().toISOString(), timeZone, scheduledHour)
  return {
    kind: 'dida.completed-cleanup', version: 2,
    initialize(_input, now) {
      const state: CleanupState = {
        projectId, timeZone, scheduledHour, pollIntervalMs, retentionDays, maxPerRun, failureThreshold, authorization, phase: 'scheduled',
      }
      return { status: 'waiting', state, wakeAt: now }
    },
    reduce(rawState, event) {
      const state = rawState as CleanupState
      if (event.type === 'timer' && state.phase === 'scheduled') {
        const slot = localSlot(event.occurredAt, state.timeZone, state.scheduledHour)
        if (!slot.due || state.lastCompletedDay === slot.day) {
          return { status: 'waiting', state, wakeAt: at(event.occurredAt, state.pollIntervalMs) }
        }
        return {
          status: 'waiting', state: { ...state, phase: 'cleaning', pendingDay: slot.day },
          wakeAt: null,
          effects: [{
            id: id('dida-completed-cleanup', state.projectId, slot.day), kind: TASK_MAINTENANCE_EFFECTS.cleanupCompleted,
            availableAt: event.occurredAt,
            payload: {
              projectId: state.projectId, cutoff: at(event.occurredAt, -state.retentionDays * DAY_MS), maxDeletes: state.maxPerRun,
              effectiveAt: event.occurredAt,
              authorization: state.authorization,
            },
          }],
        }
      }
      if (['effect.delivered', 'effect.failed'].includes(event.type) && effectKind(event) === ASSISTANT_EFFECTS.notifyOwner) return { status: 'waiting', state }
      if (event.type === 'effect.delivered' && effectKind(event) === TASK_MAINTENANCE_EFFECTS.cleanupCompleted) {
        const deleted = parseDeletedTasks(event.payload.deleted)
        const effects = []
        if (deleted.length) {
          effects.push(notificationEffect(id('dida-cleanup-result', state.projectId, state.pendingDay ?? event.occurredAt),
            `已清理 ${deleted.length} 条过期的已完成自动化待办`, deleted.slice(0, 10).map((task, index) => `${index + 1}. ${task.title}（${task.completedAt}）`).join('\n'), event.occurredAt))
        } else if (state.failure?.notified) {
          effects.push(notificationEffect(id('dida-cleanup-recovered', state.failure.at), '滴答已完成任务清理已恢复',
            `故障始于：${state.failure.at}`, event.occurredAt))
        }
        const { pendingDay, failure: _failure, ...settled } = state
        return {
          status: 'waiting', state: { ...settled, phase: 'scheduled', ...(pendingDay ? { lastCompletedDay: pendingDay } : {}) },
          wakeAt: at(event.occurredAt, state.pollIntervalMs), effects,
        }
      }
      if (event.type === 'effect.failed' && effectKind(event) === TASK_MAINTENANCE_EFFECTS.cleanupCompleted) {
        const nextFailure = failure(state.failure, event.occurredAt)
        const shouldNotify = !nextFailure.notified && nextFailure.count >= state.failureThreshold
        const { pendingDay: _pendingDay, ...withoutPending } = state
        return {
          status: 'waiting',
          state: { ...withoutPending, phase: 'scheduled', failure: { ...nextFailure, notified: nextFailure.notified || shouldNotify } },
          wakeAt: at(event.occurredAt, state.pollIntervalMs),
          ...(shouldNotify ? { effects: [notificationEffect(id('dida-cleanup-failed', nextFailure.at),
            '滴答已完成任务清理持续失败', `已连续失败 ${nextFailure.count} 次，后台会继续重试。`, event.occurredAt)] } : {}),
        }
      }
      return { status: 'waiting', state, ...(state.phase === 'scheduled' ? { wakeAt: at(event.occurredAt, state.pollIntervalMs) } : {}) }
    },
  }
}

function cleanupAuthorization(
  config: DidaMaintenanceConfig,
  projectId: string,
  retentionDays: number,
  maxPerRun: number,
): NonNullable<DidaMaintenanceConfig['cleanupAuthorization']> {
  const raw = config.cleanupAuthorization
  const evidence = requireAuthorizationEvidence(raw, 'dida.completed-task-cleanup', new Date().toISOString())
  if (!raw || raw.projectId !== projectId) throw new Error('cleanup authorization projectId must match maintenance projectId')
  const minimumRetentionDays = positiveInteger(raw.minimumRetentionDays, 0, 'authorization minimumRetentionDays')
  const maximumDeletesPerRun = positiveInteger(raw.maximumDeletesPerRun, 0, 'authorization maximumDeletesPerRun')
  if (retentionDays < minimumRetentionDays) throw new Error('completedRetentionDays exceeds the cleanup authorization scope')
  if (maxPerRun > maximumDeletesPerRun) throw new Error('cleanupMaxPerRun exceeds the cleanup authorization scope')
  return { ...evidence, projectId, minimumRetentionDays, maximumDeletesPerRun }
}

function parseOverdueTasks(value: unknown): OverdueTask[] {
  if (!Array.isArray(value)) throw new Error('overdue task effect result must contain tasks')
  return value.map((item, index) => {
    const task = record(item)
    if (!task || typeof task.taskId !== 'string' || typeof task.title !== 'string' || typeof task.dueDate !== 'string'
      || !Number.isFinite(task.priority) || Number.isNaN(new Date(task.dueDate).getTime())) throw new Error(`invalid overdue task at index ${index}`)
    return { taskId: task.taskId, title: task.title, dueDate: task.dueDate, priority: Number(task.priority), ...(typeof task.url === 'string' ? { url: task.url } : {}) }
  })
}

function parseDeletedTasks(value: unknown): DeletedTask[] {
  if (!Array.isArray(value)) throw new Error('cleanup effect result must contain deleted tasks')
  return value.map((item, index) => {
    const task = record(item)
    if (!task || typeof task.taskId !== 'string' || typeof task.title !== 'string' || typeof task.completedAt !== 'string'
      || Number.isNaN(new Date(task.completedAt).getTime())) throw new Error(`invalid deleted task at index ${index}`)
    return { taskId: task.taskId, title: task.title, completedAt: task.completedAt }
  })
}

function pruneFingerprints(value: Readonly<Record<string, { readonly fingerprint: string; readonly at: string }>>, now: string) {
  const cutoff = new Date(now).getTime() - 180 * DAY_MS
  return Object.fromEntries(Object.entries(value).filter(([, item]) => new Date(item.at).getTime() >= cutoff))
}
