import { contentDigest } from '../capability-platform/validation.js'
import type { ExecutorCapabilityReportV1 } from './contracts.js'
import { negotiateExecutor } from './negotiation.js'
import { fixedExecutorProbeSpecs, type InstalledExecutorIdV1 } from './process-discovery.js'
import { validateExecutorCapabilityReport } from './validation.js'

export interface InactiveExecutablePilotPreflightV1 {
  readonly schemaVersion: 1
  readonly tenantId: string
  readonly deviceId: string
  readonly probePolicyDigest: string
  readonly reportDigests: readonly string[]
  readonly selectedExecutorId: InstalledExecutorIdV1 | null
  readonly selectionReason: 'preferred-ready' | 'fallback-ready' | 'none-ready'
  readonly state: 'ready-unarmed' | 'blocked-unarmed'
  readonly listenerStarted: false
  readonly executorInvoked: false
  readonly externalWritesEnabled: false
  readonly currentOwnerPreserved: true
  readonly evaluatedAt: string
}

const executorOrder: readonly InstalledExecutorIdV1[] = ['claude-code', 'codex', 'dsh']

/**
 * Produces the last offline gate before a real loopback pilot. It does not own
 * a process runner, socket, executor adapter, persistence provider or effect sink.
 */
export function prepareInactiveExecutablePilotPreflight(
  input: {
    readonly tenantId: string
    readonly deviceId: string
    readonly reports: readonly ExecutorCapabilityReportV1[]
  },
  now: Date,
): InactiveExecutablePilotPreflightV1 {
  if (!input.tenantId.startsWith('test.') || Number.isNaN(now.getTime())) throw new Error('executable pilot accepts a valid test tenant only')
  if (input.reports.length !== executorOrder.length) throw new Error('executable pilot requires one report for every supported executor')
  const reports = input.reports.map(validateExecutorCapabilityReport)
  if (new Set(reports.map(report => report.executorId)).size !== executorOrder.length) throw new Error('executable pilot executor reports must be unique')
  for (const executorId of executorOrder) {
    const report = reports.find(candidate => candidate.executorId === executorId)
    if (!report || report.deviceId !== input.deviceId) throw new Error('executable pilot report scope is incomplete')
  }

  let selectedExecutorId: InstalledExecutorIdV1 | null = null
  let selectionReason: InactiveExecutablePilotPreflightV1['selectionReason'] = 'none-ready'
  try {
    const selection = negotiateExecutor({
      protocolVersions: ['envelope.v1'],
      capabilities: ['agent.execute', 'tool.execute'],
      allowedExecutors: executorOrder,
      preferredExecutors: ['claude-code', 'codex'],
    }, reports, now)
    selectedExecutorId = selection.executorId as InstalledExecutorIdV1
    selectionReason = selection.reason
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'no eligible executor satisfies the signed plan requirements') throw error
  }

  return deepFreeze({
    schemaVersion: 1,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    probePolicyDigest: contentDigest(fixedExecutorProbeSpecs()),
    reportDigests: reports.map(report => contentDigest(report)),
    selectedExecutorId,
    selectionReason,
    state: selectedExecutorId ? 'ready-unarmed' : 'blocked-unarmed',
    listenerStarted: false,
    executorInvoked: false,
    externalWritesEnabled: false,
    currentOwnerPreserved: true,
    evaluatedAt: now.toISOString(),
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
