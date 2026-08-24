export interface RuntimeSnapshot {
  readonly mode: 'control-only' | 'compat'
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

/** Neutral runtime status used when no message consumer feature is mounted. */
export class ControlOnlyRuntime implements RuntimeStatusProvider {
  snapshot(): RuntimeSnapshot {
    return { mode: 'control-only', state: 'stopped', messageReady: false, cardReady: false }
  }
}
