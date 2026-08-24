import { Context, Service } from '@deepseek-ai/cordis'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type {} from '../storage/service-contract.js'

export interface DurableEventConsumer { readonly name: string; readonly eventKeys: readonly string[]; handle(event: NormalizedChannelEvent): Promise<void> }
export interface DurableEventRuntimeConfig { readonly workerId: string; readonly enabled?: boolean; readonly pollIntervalMs?: number; readonly leaseMs?: number; readonly retryDelayMs?: number; readonly maxAttempts?: number }
declare module '@deepseek-ai/cordis' { interface Context { quarkEvents: DurableEventRuntime } }

export const DEFAULT_EVENT_RECOVERY_POLL_INTERVAL_MS = 600_000

export class DurableEventRuntime extends Service {
  private readonly consumers = new Map<string, DurableEventConsumer>()
  private running = false
  private wakePending = false
  private draining = false
  constructor(ctx: Context, private readonly config: DurableEventRuntimeConfig) {
    super(ctx, 'quarkEvents')
    if (!config.workerId?.trim()) throw new Error('durable event runtime workerId is required')
    if (config.enabled === true) {
      ctx.on('quark/event-appended', () => this.wake())
      const timer = setInterval(() => this.wake(), config.pollIntervalMs ?? DEFAULT_EVENT_RECOVERY_POLL_INTERVAL_MS)
      timer.unref()
      ctx.effect(() => () => clearInterval(timer), 'quark durable event recovery timer')
    }
  }
  register(consumer: DurableEventConsumer): () => void {
    if (!consumer.name.trim() || consumer.eventKeys.length === 0 || consumer.eventKeys.some(key => !key.trim())) throw new Error('event consumer requires a name and event keys')
    if (this.consumers.has(consumer.name)) throw new Error(`event consumer ${consumer.name} is already registered`)
    this.consumers.set(consumer.name, consumer)
    this.wake()
    return () => this.consumers.delete(consumer.name)
  }
  /** Coalesced in-process wake-up; the long poll interval only recovers missed wake-ups after restart. */
  wake(): void {
    if (this.config.enabled !== true) return
    this.wakePending = true
    if (this.draining) return
    this.draining = true
    queueMicrotask(() => void this.drain())
  }
  async runOnce(now = new Date()): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }> {
    if (this.running) return { claimed: 0, delivered: 0, failed: 0 }
    this.running = true; let claimed = 0; let delivered = 0; let failed = 0
    try {
      for (const consumer of this.consumers.values()) {
        const item = await this.ctx.quarkState.claimNextEvent(consumer.name, consumer.eventKeys, this.config.workerId, now.toISOString(), new Date(now.getTime() + (this.config.leaseMs ?? 120_000)).toISOString())
        if (!item) continue
        claimed += 1
        try { await consumer.handle(item.event); await this.ctx.quarkState.settleEvent(consumer.name, item.id, this.config.workerId, new Date().toISOString()); delivered += 1 }
        catch (error) { const terminal = item.attempt >= (this.config.maxAttempts ?? 5); await this.ctx.quarkState.releaseEvent({ consumerName: consumer.name, eventId: item.id, workerId: this.config.workerId, error: error instanceof Error ? error.message : String(error), availableAt: new Date(now.getTime() + (this.config.retryDelayMs ?? 120_000)).toISOString(), terminal }); failed += Number(terminal) }
      }
      return { claimed, delivered, failed }
    } finally { this.running = false }
  }

  private async drain(): Promise<void> {
    try {
      let passes = 0
      while (this.wakePending && passes < 100) {
        this.wakePending = false
        const result = await this.runOnce()
        if (result.claimed > 0) this.wakePending = true
        passes += 1
      }
    } catch (error) {
      this.ctx.logger('quark-events').error(error)
    } finally {
      this.draining = false
      if (this.wakePending) this.wake()
    }
  }
}
export const name = 'quark-durable-events'
export const inject = ['quarkState']
export function apply(ctx: Context, config: DurableEventRuntimeConfig): void { ctx.plugin(DurableEventRuntime, config) }
