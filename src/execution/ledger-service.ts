import { Context, Service } from '@deepseek-ai/cordis'
import type { DurableActionInput } from '../storage/types.js'
import type {} from '../storage/service-contract.js'

export interface ActionLedgerConfig {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkActionLedger: ActionLedgerService
  }
}

export class ActionLedgerService extends Service {
  constructor(ctx: Context, _config: ActionLedgerConfig = {}) {
    super(ctx, 'quarkActionLedger')
  }

  async enqueue(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    return await this.ctx.quarkState.enqueueAction(input)
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt = new Date().toISOString()): Promise<void> {
    await this.ctx.quarkState.decideApproval(approvalId, decision, metadata, decidedAt)
  }
}
