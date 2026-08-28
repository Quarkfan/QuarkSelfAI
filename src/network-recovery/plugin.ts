import { Context, Service } from '@deepseek-ai/cordis'
import { NetworkRecoveryAdapter } from './adapter.js'
import { isNetworkRecoveryCandidate, recoveryBucket } from './policy.js'
import type { ExecutorInfrastructureFailureSignal, NetworkRecoveryConfig, NetworkRecoveryReport } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context { quarkNetworkRecovery: NetworkRecoveryService }
  interface Events {
    'quark/executor-infrastructure-failure'(signal: ExecutorInfrastructureFailureSignal): void
    'quark/network-recovery-failed'(report: NetworkRecoveryReport): void
  }
}

export class NetworkRecoveryService extends Service {
  private readonly adapter: NetworkRecoveryAdapter
  private active: Promise<NetworkRecoveryReport> | undefined
  private lastBucket?: string

  constructor(ctx: Context, private readonly config: NetworkRecoveryConfig = {}) {
    super(ctx, 'quarkNetworkRecovery')
    this.adapter = new NetworkRecoveryAdapter(config)
    ctx.on('quark/executor-infrastructure-failure', signal => { void this.handle(signal) })
  }

  async handle(signal: ExecutorInfrastructureFailureSignal): Promise<NetworkRecoveryReport | undefined> {
    if (!isNetworkRecoveryCandidate(signal, this.config.minimumExecutorAttempts ?? 2)) return undefined
    const bucket = recoveryBucket(signal.occurredAt, this.config.cooldownMs ?? 30 * 60_000)
    if (this.lastBucket === bucket) return undefined
    if (this.active) return await this.active
    this.lastBucket = bucket
    this.active = this.adapter.recover()
    try {
      const report = await this.active
      if (report.notificationRequired) this.ctx.emit('quark/network-recovery-failed', report)
      return report
    } finally { this.active = undefined }
  }
}

export const name = 'quark-network-recovery'
export const inject: readonly string[] = []
export function apply(ctx: Context, config: NetworkRecoveryConfig = {}): void { ctx.plugin(NetworkRecoveryService, config) }
export * from './types.js'
export * from './policy.js'
export * from './adapter.js'
