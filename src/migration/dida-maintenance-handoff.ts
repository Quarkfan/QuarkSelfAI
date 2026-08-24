import { createHash } from 'node:crypto'
import type { CreateWorkflowInput } from '../storage/types.js'
import { completedCleanupWorkflow, overdueWorkflow } from '../task-maintenance/workflows.js'
import type { DidaMaintenanceConfig } from '../task-maintenance/types.js'

export interface DidaMaintenanceHandoff {
  readonly workflows: readonly CreateWorkflowInput[]
  readonly digest: string
  readonly counts: { readonly overdueFingerprints: number; readonly healthFailures: number }
}

export interface DidaMaintenanceHandoffTarget {
  createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean }>
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function legacyFailure(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const item = record(value)
  if (typeof item.at !== 'string' || Number.isNaN(new Date(item.at).getTime())) return undefined
  const count = item.count ?? 0
  if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error('legacy Dida failure count must be a non-negative integer')
  return { at: item.at, count: Number(count), notified: item.notified === true }
}

function legacyDay(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw new Error('legacy Dida cleanup day must use YYYY-MM-DD')
  return value
}

export function prepareDidaMaintenanceHandoff(
  legacyRoot: unknown,
  config: DidaMaintenanceConfig,
  frozenAt: string,
): DidaMaintenanceHandoff {
  if (Number.isNaN(new Date(frozenAt).getTime())) throw new Error('Dida maintenance handoff frozenAt must be a timestamp')
  const root = record(legacyRoot)
  const overdueDefinition = overdueWorkflow(config)
  const cleanupDefinition = completedCleanupWorkflow(config)
  const overdueInitial = overdueDefinition.initialize({}, frozenAt)
  const cleanupInitial = cleanupDefinition.initialize({}, frozenAt)
  const legacyFingerprints = record(root.overdueNotified)
  const notified = Object.fromEntries(Object.entries(legacyFingerprints).flatMap(([taskId, fingerprint]) => (
    typeof fingerprint === 'string' && fingerprint ? [[taskId, { fingerprint, at: frozenAt }]] : []
  )))
  const overdueFailure = legacyFailure(root.overdueHealthFailure)
  const cleanupFailure = legacyFailure(root.didaCompletedCleanupHealthFailure)
  const lastCompletedDay = legacyDay(root.didaCompletedCleanupLastDay)
  const overdueState = {
    ...overdueInitial.state,
    notified,
    ...(overdueFailure ? { failure: overdueFailure } : {}),
  }
  const cleanupState = {
    ...cleanupInitial.state,
    ...(lastCompletedDay ? { lastCompletedDay } : {}),
    ...(cleanupFailure ? { failure: cleanupFailure } : {}),
  }
  const workflows: CreateWorkflowInput[] = [{
    id: `dida-overdue:${config.projectId}`, kind: overdueDefinition.kind, definitionVersion: overdueDefinition.version,
    status: 'waiting', state: overdueState, wakeAt: frozenAt,
  }, {
    id: `dida-cleanup:${config.projectId}`, kind: cleanupDefinition.kind, definitionVersion: cleanupDefinition.version,
    status: 'waiting', state: cleanupState, wakeAt: frozenAt,
  }]
  return {
    workflows,
    digest: createHash('sha256').update(canonical(workflows)).digest('hex'),
    counts: { overdueFingerprints: Object.keys(notified).length, healthFailures: Number(Boolean(overdueFailure)) + Number(Boolean(cleanupFailure)) },
  }
}

export async function applyDidaMaintenanceHandoff(
  target: DidaMaintenanceHandoffTarget,
  handoff: DidaMaintenanceHandoff,
  expectedDigest: string,
): Promise<{ readonly inserted: number; readonly existing: number }> {
  if (handoff.digest !== expectedDigest) throw new Error('Dida maintenance handoff digest changed after audit')
  let inserted = 0
  for (const workflow of handoff.workflows) if ((await target.createWorkflow(workflow)).inserted) inserted += 1
  return { inserted, existing: handoff.workflows.length - inserted }
}
