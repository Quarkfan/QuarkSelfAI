import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DurableActionInput } from '../storage/types.js'
import { DurableExecutorWorker, type DurableWorkerRun } from './worker.js'
import type {} from '../storage/service.js'

export interface ActionLedgerConfig {
  readonly workerId: string
  readonly leaseMs?: number
  readonly retryDelayMs?: number
  readonly maxAttempts?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkActionLedger: ActionLedgerService
  }
}

export class ActionLedgerService extends Service {
  private readonly worker: DurableExecutorWorker

  constructor(ctx: Context, config: ActionLedgerConfig) {
    super(ctx, 'quarkActionLedger')
    if (!config.workerId?.trim()) throw new Error('action ledger workerId is required')
    this.worker = new DurableExecutorWorker(ctx.quarkState, ctx.quarkExecutors, {
      workerId: config.workerId,
      ...(config.leaseMs === undefined ? {} : { leaseMs: config.leaseMs }),
      ...(config.retryDelayMs === undefined ? {} : { retryDelayMs: config.retryDelayMs }),
      ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    })
  }

  async enqueue(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    return await this.ctx.quarkState.enqueueAction(input)
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt = new Date().toISOString()): Promise<void> {
    await this.ctx.quarkState.decideApproval(approvalId, decision, metadata, decidedAt)
  }

  async runOnce(parent: Agent, signal: AbortSignal): Promise<DurableWorkerRun> {
    return await this.worker.runOnce(parent, signal)
  }
}
