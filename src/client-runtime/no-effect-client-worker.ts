import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { ExecutorCapabilityReportV1 } from './contracts.js'
import type { InactiveClientCycleReceiptV1, NoEffectClientExecutionReceiptV1 } from './inactive-client-cycle.js'
import type { InstalledExecutorDiscoveryDependenciesV1 } from './installed-executor-discovery.js'
import type { ProductReasoningExecutorDependenciesV1 } from './reasoning-executor-composition.js'

const minCycleIntervalMs = 5_000
const maxCycleIntervalMs = 300_000
const minDiscoveryIntervalMs = 30_000
const maxDiscoveryIntervalMs = 3_600_000

export interface NoEffectClientWorkerConfigV1 {
  readonly schemaVersion: 1
  readonly enabled: true
  readonly workspacePath: string
  readonly cycleIntervalMs: number
  readonly discoveryIntervalMs: number
  readonly externalWritesEnabled: false
}

export interface NoEffectConfiguredClientPortV1 {
  refreshInstalledExecutors(cwd: string, now?: Date, dependencies?: InstalledExecutorDiscoveryDependenciesV1): Promise<readonly ExecutorCapabilityReportV1[]>
  executeSignedReasoningNoEffectOnce(now?: Date, dependencies?: ProductReasoningExecutorDependenciesV1): Promise<NoEffectClientExecutionReceiptV1>
}

export interface ClientWorkerSchedulePortV1 {
  schedule(delayMs: number, callback: () => void): unknown
  cancel(handle: unknown): void
}

export interface NoEffectClientWorkerDependenciesV1 {
  readonly clock?: () => Date
  readonly schedule?: ClientWorkerSchedulePortV1
  readonly discovery?: InstalledExecutorDiscoveryDependenciesV1
  readonly reasoning?: ProductReasoningExecutorDependenciesV1
}

interface ResolvedNoEffectClientWorkerDependenciesV1 {
  readonly clock: () => Date
  readonly schedule: ClientWorkerSchedulePortV1
  readonly discovery: InstalledExecutorDiscoveryDependenciesV1 | undefined
  readonly reasoning: ProductReasoningExecutorDependenciesV1 | undefined
}

export interface NoEffectClientWorkerSnapshotV1 {
  readonly schemaVersion: 1
  readonly state: 'stopped' | 'running' | 'stopping' | 'degraded'
  readonly passCount: number
  readonly lastPassAt: string | null
  readonly lastDiscoveryAt: string | null
  readonly lastReceiptState: InactiveClientCycleReceiptV1['state'] | NoEffectClientExecutionReceiptV1['state'] | null
  readonly lastFailure: 'client-cycle-failed' | null
  readonly externalWritesEnabled: false
}

/** Explicitly started single-owner worker. It never overlaps cycles and owns no effect path. */
export class NoEffectConfiguredClientWorkerV1 {
  #state: NoEffectClientWorkerSnapshotV1['state'] = 'stopped'
  #passCount = 0
  #lastPassAt: string | null = null
  #lastDiscoveryAt: string | null = null
  #lastReceiptState: NoEffectClientWorkerSnapshotV1['lastReceiptState'] = null
  #lastFailure: NoEffectClientWorkerSnapshotV1['lastFailure'] = null
  #timer: unknown
  #inFlight: Promise<void> | null = null

  private constructor(
    private readonly config: NoEffectClientWorkerConfigV1,
    private readonly client: NoEffectConfiguredClientPortV1,
    private readonly dependencies: ResolvedNoEffectClientWorkerDependenciesV1,
  ) {}

  static async create(config: NoEffectClientWorkerConfigV1, client: NoEffectConfiguredClientPortV1, dependencies: NoEffectClientWorkerDependenciesV1 = {}): Promise<NoEffectConfiguredClientWorkerV1> {
    exactConfig(config)
    const [canonical, status] = await Promise.all([realpath(config.workspacePath), lstat(config.workspacePath)])
    if (canonical !== config.workspacePath || !status.isDirectory() || status.isSymbolicLink()) throw new Error('client worker workspace must be a canonical directory')
    return new NoEffectConfiguredClientWorkerV1(Object.freeze({ ...config }), client, {
      clock: dependencies.clock ?? (() => new Date()),
      schedule: dependencies.schedule ?? nodeSchedule,
      discovery: dependencies.discovery,
      reasoning: dependencies.reasoning,
    })
  }

  snapshot(): NoEffectClientWorkerSnapshotV1 {
    return Object.freeze({ schemaVersion: 1, state: this.#state, passCount: this.#passCount, lastPassAt: this.#lastPassAt, lastDiscoveryAt: this.#lastDiscoveryAt, lastReceiptState: this.#lastReceiptState, lastFailure: this.#lastFailure, externalWritesEnabled: false })
  }

  /** Starts exactly one immediate pass. Construction alone is inert. */
  start(): void {
    if (this.#state !== 'stopped') throw new Error('client worker is already started')
    this.#state = 'running'
    this.#launchPass()
  }

  /** Stops future polling and waits for the exact in-flight pass instead of spawning a replacement owner. */
  async stop(): Promise<void> {
    if (this.#state === 'stopped') return
    this.#state = 'stopping'
    if (this.#timer !== undefined) { this.dependencies.schedule.cancel(this.#timer); this.#timer = undefined }
    await this.#inFlight
    this.#state = 'stopped'
  }

  #launchPass(): void {
    if (!['running', 'degraded'].includes(this.#state) || this.#inFlight) return
    const pass = this.#runPass()
    this.#inFlight = pass
    void pass.finally(() => {
      this.#inFlight = null
      if (!['running', 'degraded'].includes(this.#state)) return
      this.#timer = this.dependencies.schedule.schedule(this.config.cycleIntervalMs, () => { this.#timer = undefined; this.#launchPass() })
    })
  }

  async #runPass(): Promise<void> {
    const now = this.dependencies.clock()
    if (Number.isNaN(now.getTime())) { this.#state = 'degraded'; this.#lastFailure = 'client-cycle-failed'; return }
    try {
      if (this.#lastDiscoveryAt === null || now.getTime() - Date.parse(this.#lastDiscoveryAt) >= this.config.discoveryIntervalMs) {
        await this.client.refreshInstalledExecutors(this.config.workspacePath, now, this.dependencies.discovery)
        this.#lastDiscoveryAt = now.toISOString()
      }
      const receipt = await this.client.executeSignedReasoningNoEffectOnce(now, this.dependencies.reasoning)
      this.#passCount += 1; this.#lastPassAt = now.toISOString(); this.#lastReceiptState = receipt.state; this.#lastFailure = null
      if (this.#state === 'degraded') this.#state = 'running'
    } catch {
      this.#passCount += 1; this.#lastPassAt = now.toISOString(); this.#lastFailure = 'client-cycle-failed'
      if (this.#state !== 'stopping') this.#state = 'degraded'
    }
  }
}

const nodeSchedule: ClientWorkerSchedulePortV1 = {
  schedule(delayMs, callback) { return setTimeout(callback, delayMs) },
  cancel(handle) { clearTimeout(handle as NodeJS.Timeout) },
}

function exactConfig(value: NoEffectClientWorkerConfigV1): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client worker config is invalid')
  const keys = ['schemaVersion', 'enabled', 'workspacePath', 'cycleIntervalMs', 'discoveryIntervalMs', 'externalWritesEnabled']
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || value.enabled !== true || value.externalWritesEnabled !== false || !isAbsolute(value.workspacePath) || resolve(value.workspacePath) !== value.workspacePath || !Number.isSafeInteger(value.cycleIntervalMs) || value.cycleIntervalMs < minCycleIntervalMs || value.cycleIntervalMs > maxCycleIntervalMs || !Number.isSafeInteger(value.discoveryIntervalMs) || value.discoveryIntervalMs < minDiscoveryIntervalMs || value.discoveryIntervalMs > maxDiscoveryIntervalMs) throw new Error('client worker config is invalid')
}
