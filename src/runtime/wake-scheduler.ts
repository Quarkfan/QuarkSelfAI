export const DEFAULT_DURABLE_RECOVERY_INTERVAL_MS = 600_000
const MAX_TIMER_DELAY_MS = 2_147_000_000

export interface DurableWakeSchedulerOptions<Result> {
  readonly enabled: boolean
  readonly recoveryIntervalMs?: number
  readonly maxPasses?: number
  run(): Promise<Result>
  continueAfter(result: Result): boolean
  onError(error: unknown): void
}

/**
 * Coalesces commit hints, keeps one exact future timer, and retains a slow
 * recovery scan. The durable store remains authoritative; wake-ups are hints.
 */
export class DurableWakeScheduler<Result> {
  private wakePending = false
  private draining = false
  private scheduledTimer: NodeJS.Timeout | undefined
  private scheduledAt: number | undefined
  private recoveryTimer: NodeJS.Timeout | undefined
  private drainImmediate: NodeJS.Immediate | undefined
  private disposed = false

  constructor(private readonly options: DurableWakeSchedulerOptions<Result>) {
    const recoveryIntervalMs = options.recoveryIntervalMs ?? DEFAULT_DURABLE_RECOVERY_INTERVAL_MS
    if (!Number.isSafeInteger(recoveryIntervalMs) || recoveryIntervalMs < 1_000) {
      throw new Error('durable wake recoveryIntervalMs must be an integer of at least 1000')
    }
    if (options.enabled) {
      this.recoveryTimer = setInterval(() => this.wake(), recoveryIntervalMs)
      this.recoveryTimer.unref()
    }
  }

  wake(at?: string): void {
    if (!this.options.enabled || this.disposed) return
    const now = Date.now()
    const timestamp = at ? new Date(at).getTime() : now
    if (!Number.isFinite(timestamp) || timestamp <= now) {
      this.wakePending = true
      if (this.draining) return
      this.draining = true
      this.drainImmediate = setImmediate(() => {
        this.drainImmediate = undefined
        void this.drain()
      })
      this.drainImmediate.unref()
      return
    }
    if (this.scheduledAt !== undefined && this.scheduledAt <= timestamp) return
    if (this.scheduledTimer) clearTimeout(this.scheduledTimer)
    this.scheduledAt = timestamp
    this.scheduleFuture(timestamp)
  }

  dispose(): void {
    this.disposed = true
    this.wakePending = false
    if (this.recoveryTimer) clearInterval(this.recoveryTimer)
    if (this.scheduledTimer) clearTimeout(this.scheduledTimer)
    if (this.drainImmediate) clearImmediate(this.drainImmediate)
    this.recoveryTimer = undefined
    this.scheduledTimer = undefined
    this.drainImmediate = undefined
    this.scheduledAt = undefined
  }

  private scheduleFuture(timestamp: number): void {
    const delay = Math.min(Math.max(0, timestamp - Date.now()), MAX_TIMER_DELAY_MS)
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = undefined
      if (this.disposed) return
      if (timestamp > Date.now()) {
        this.scheduleFuture(timestamp)
        return
      }
      this.scheduledAt = undefined
      this.wake(new Date(timestamp).toISOString())
    }, delay)
    this.scheduledTimer.unref()
  }

  private async drain(): Promise<void> {
    try {
      let passes = 0
      const maximum = this.options.maxPasses ?? 100
      while (!this.disposed && this.wakePending && passes < maximum) {
        this.wakePending = false
        const result = await this.options.run()
        if (this.options.continueAfter(result)) this.wakePending = true
        passes += 1
      }
    } catch (error) {
      this.options.onError(error)
    } finally {
      this.draining = false
      if (!this.disposed && this.wakePending) this.wake()
    }
  }
}
