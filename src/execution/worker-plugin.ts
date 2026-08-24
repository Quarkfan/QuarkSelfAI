import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { DurableExecutorWorker, type DurableWorkerRun, type DurableExecutorWorkerConfig } from './worker.js'
import type {} from '../storage/service.js'
import type {} from './router.js'

declare module '@deepseek-ai/cordis' {
  interface Context { quarkActionWorker: ActionWorkerService }
}

/**
 * Agent-bound execution is deliberately separate from the durable ledger.
 * External intake cannot borrow an arbitrary live conversation as its parent;
 * a conversation dispatcher must supply the exact DSH agent explicitly.
 */
export class ActionWorkerService extends Service {
  private readonly worker: DurableExecutorWorker

  constructor(ctx: Context, config: DurableExecutorWorkerConfig) {
    super(ctx, 'quarkActionWorker')
    this.worker = new DurableExecutorWorker(ctx.quarkState, ctx.quarkExecutors, config)
  }

  runOnce(parent: Agent, signal: AbortSignal): Promise<DurableWorkerRun> {
    return this.worker.runOnce(parent, signal)
  }
}

export const name = 'quark-agent-action-worker'
export const inject = ['agents', 'quarkState', 'quarkExecutors']
export function apply(ctx: Context, config: DurableExecutorWorkerConfig): void {
  ctx.plugin(ActionWorkerService, config)
}
