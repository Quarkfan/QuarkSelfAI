export interface RuntimeSnapshot {
  /** Open provider id; the skeleton must not enumerate every runtime implementation. */
  readonly mode: string
  /** False for an intentionally absent consumer provider such as control-only diagnostics. */
  readonly requiredForHealth?: boolean
  /** Provider-owned display state; avoids teaching the generic console migration names. */
  readonly operationalMode?: string
  readonly state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed'
  readonly pid?: number
  readonly messageReady: boolean
  readonly cardReady: boolean
  readonly requiredEventKeys?: readonly string[]
  readonly readyEventKeys?: readonly string[]
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

export interface TakeoverReadinessReport {
  readonly source: string
  readonly features: readonly unknown[]
  readonly takeoverReady: boolean
  readonly missingRequired: number
  readonly completed: number
  readonly nativeCutoverReady?: boolean
  readonly nativeCutoverBlockers?: readonly string[]
}

export interface TakeoverReadinessProvider { inspect(): Promise<TakeoverReadinessReport> }

/** Neutral runtime status used when no message consumer feature is mounted. */
export class ControlOnlyRuntime implements RuntimeStatusProvider {
  snapshot(): RuntimeSnapshot {
    return {
      mode: 'control-only', operationalMode: 'migration', requiredForHealth: false,
      state: 'stopped', messageReady: false, cardReady: false,
    }
  }
}

export class ControlOnlyKernel implements KernelStatusProvider {
  snapshot(): KernelSnapshot { return { mode: 'off', state: 'stopped' } }
}

export class UnconfiguredReadiness implements TakeoverReadinessProvider {
  async inspect(): Promise<TakeoverReadinessReport> {
    return { source: 'unconfigured', features: [], takeoverReady: false, missingRequired: 0, completed: 0, nativeCutoverReady: false, nativeCutoverBlockers: ['readiness-provider-unconfigured'] }
  }
}
