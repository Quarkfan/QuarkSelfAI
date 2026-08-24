import { createHash } from 'node:crypto'
import type { CreateWorkflowInput } from '../storage/types.js'
import { sessionLifecycleWorkflow, type SessionLifecycleState } from '../session-lifecycle/workflow.js'
import type { SessionLifecycleConfig } from '../session-lifecycle/types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export interface SessionLifecycleHandoff {
  readonly workflows: readonly CreateWorkflowInput[]
  readonly digest: string
  readonly counts: { readonly tracked: number; readonly archived: number; readonly deleted: number; readonly waiting: number; readonly failures: number }
}
export interface SessionLifecycleHandoffTarget {
  createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean }>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function timestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a timestamp`)
  return value
}
function count(value: unknown, label: string): number {
  const selected = value ?? 0
  if (!Number.isSafeInteger(selected) || Number(selected) < 0) throw new Error(`${label} must be a non-negative integer`)
  return Number(selected)
}
function later(...values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] as string
}

export function prepareSessionLifecycleHandoff(legacyRoot: unknown, config: SessionLifecycleConfig, frozenAt: string): SessionLifecycleHandoff {
  timestamp(frozenAt, 'frozenAt')
  const root = record(legacyRoot) ?? {}
  const waitingIds = new Set(array(root.mentionClarifications).flatMap(item => {
    const value = record(item)?.researchSessionId
    return typeof value === 'string' && value ? [value] : []
  }))
  const definition = sessionLifecycleWorkflow(config)
  const seen = new Set<string>()
  let archivedCount = 0; let deletedCount = 0; let failureCount = 0
  const workflows = array(root.mentionResearchSessions).map((value, index): CreateWorkflowInput => {
    const item = record(value)
    if (!item || typeof item.sessionId !== 'string' || !UUID.test(item.sessionId)) throw new Error(`research session ${index} has no exact UUID`)
    if (seen.has(item.sessionId)) throw new Error(`research session ${index} duplicates sessionId`)
    seen.add(item.sessionId)
    if (typeof item.taskId !== 'string' || !item.taskId.trim()) throw new Error(`research session ${index} has no taskId`)
    const createdAt = timestamp(item.createdAt, `research session ${index} createdAt`) ?? frozenAt
    const archivedAt = timestamp(item.archivedAt, `research session ${index} archivedAt`)
    const deletedAt = timestamp(item.deletedAt, `research session ${index} deletedAt`)
    if (deletedAt && !archivedAt) throw new Error(`research session ${index} is deleted without archivedAt`)
    if (archivedAt) archivedCount += 1
    if (deletedAt) deletedCount += 1
    const initialized = definition.initialize({ sessionId: item.sessionId, taskId: item.taskId,
      eligible: !waitingIds.has(item.sessionId), createdAt, managedBy: 'quarkselfai-auto-research' }, frozenAt)
    const base = initialized.state as SessionLifecycleState
    const operation = archivedAt ? 'delete' as const : 'archive' as const
    const failures = count(archivedAt ? item.deleteFailureCount : item.archiveFailureCount, `research session ${index} failure count`)
    failureCount += failures
    const failureAt = timestamp(archivedAt ? item.deleteLastAttemptAt : item.archiveLastAttemptAt, `research session ${index} failure at`)
    const notifiedAt = timestamp(archivedAt ? item.deleteLastNotifiedAt : item.archiveLastNotifiedAt, `research session ${index} notification at`)
    const retryAt = timestamp(archivedAt ? item.deleteNextRetryAt : item.archiveNextRetryAt, `research session ${index} retry at`)
    const failure = failures > 0 ? { operation, at: failureAt ?? frozenAt, count: failures, ...(notifiedAt ? { lastNotifiedAt: notifiedAt } : {}) } : undefined
    const phase = deletedAt ? 'completed' : archivedAt ? 'archived' : 'waiting'
    const state: SessionLifecycleState = { ...base, phase, ...(archivedAt ? { archivedAt } : {}), ...(deletedAt ? { deletedAt } : {}), ...(failure ? { failure } : {}) }
    const status = deletedAt ? 'completed' as const : 'waiting' as const
    const wakeAt = deletedAt ? undefined : archivedAt
      ? later(frozenAt, new Date(new Date(archivedAt).getTime() + base.deleteAfterMs).toISOString(), retryAt)
      : later(frozenAt, retryAt)
    return { id: `session-lifecycle:${item.sessionId}`, kind: definition.kind, definitionVersion: definition.version,
      status, state, ...(wakeAt ? { wakeAt } : {}) }
  })
  return { workflows, digest: createHash('sha256').update(canonical(workflows)).digest('hex'), counts: {
    tracked: workflows.length, archived: archivedCount, deleted: deletedCount,
    waiting: workflows.filter(workflow => workflow.state.eligible === false).length, failures: failureCount,
  } }
}

export async function applySessionLifecycleHandoff(target: SessionLifecycleHandoffTarget, handoff: SessionLifecycleHandoff, expectedDigest: string) {
  if (handoff.digest !== expectedDigest) throw new Error('session lifecycle handoff digest changed after audit')
  let inserted = 0
  for (const workflow of handoff.workflows) if ((await target.createWorkflow(workflow)).inserted) inserted += 1
  return { inserted, existing: handoff.workflows.length - inserted }
}
