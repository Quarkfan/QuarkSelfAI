export interface RuntimeCapabilityStatus {
  /** Open capability id owned by the contributing runtime provider. */
  readonly id: string
  readonly required: boolean
  readonly state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed'
  readonly detail?: string
}

export interface RuntimeSnapshot {
  /** Open provider id; the skeleton must not enumerate every runtime implementation. */
  readonly mode: string
  /** False for an intentionally absent consumer provider such as control-only diagnostics. */
  readonly requiredForHealth?: boolean
  /** Provider-owned display state; avoids teaching the generic console migration names. */
  readonly operationalMode?: string
  readonly state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed'
  readonly pid?: number
  /** Provider-owned capabilities; the skeleton does not enumerate channels or protocols. */
  readonly capabilities: readonly RuntimeCapabilityStatus[]
  readonly startedAt?: string
  readonly lastError?: string
}

export interface RuntimeStatusProvider {
  snapshot(): RuntimeSnapshot
  diagnostics?(): Promise<RuntimeDiagnostics>
  updateMonitor?(id: string, input: { enabled?: boolean; intervalMs?: number }): Promise<void>
}

export interface MonitorDiagnostic {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly intervalMs: number | undefined
  readonly lastRunAt?: string | null
  readonly nextRunAt?: string | null
  readonly failure?: string | null
  readonly pending?: number
}

export interface RuntimeDiagnostics {
  readonly monitors: readonly MonitorDiagnostic[]
  readonly queues: Readonly<Record<string, number>>
  readonly retention: Readonly<Record<string, number | boolean>>
}

export interface KernelSnapshot {
  readonly mode: 'off' | 'dsh'
  readonly state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed'
  readonly profile?: string
  readonly pid?: number
  readonly startedAt?: string
  readonly lastError?: string
}

export interface KernelStatusProvider { snapshot(): KernelSnapshot }

export interface ReadinessItem {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly evidence?: string
}

export interface OperationalReadinessReport {
  /** Open gate id such as native-cutover, server-release or credential-health. */
  readonly id: string
  readonly source: string
  readonly state: 'ready' | 'blocked' | 'unknown'
  readonly items: readonly ReadinessItem[]
  readonly blockers: readonly string[]
  readonly summary: Readonly<Record<string, string | number | boolean>>
}

export interface OperationalReadinessProvider { inspect(): Promise<OperationalReadinessReport> }

/** Neutral runtime status used when no message consumer feature is mounted. */
export class ControlOnlyRuntime implements RuntimeStatusProvider {
  snapshot(): RuntimeSnapshot {
    return {
      mode: 'control-only', operationalMode: 'control-only', requiredForHealth: false,
      state: 'stopped', capabilities: [],
    }
  }
}

export class ControlOnlyKernel implements KernelStatusProvider {
  snapshot(): KernelSnapshot { return { mode: 'off', state: 'stopped' } }
}

export class UnconfiguredReadiness implements OperationalReadinessProvider {
  async inspect(): Promise<OperationalReadinessReport> {
    return {
      id: 'unconfigured', source: 'unconfigured', state: 'unknown', items: [],
      blockers: ['readiness-provider-unconfigured'], summary: {},
    }
  }
}
