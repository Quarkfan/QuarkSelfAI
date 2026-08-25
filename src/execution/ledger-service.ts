import { Context, Service } from '@deepseek-ai/cordis'
import type { DurableActionInput } from '../storage/types.js'
import type { DurableStatePort } from '../storage/service-contract.js'
import type { ActionLedgerPort } from './ledger-contract.js'
export type { ActionLedgerPort } from './ledger-contract.js'

export interface ActionLedgerConfig {}

export class ActionLedgerService extends Service implements ActionLedgerPort {
  static inject = ['quarkState']
  private readonly state: DurableStatePort
  constructor(ctx: Context, _config: ActionLedgerConfig = {}) {
    super(ctx, 'quarkActionLedger')
    this.state = ctx.quarkState
  }

  async enqueue(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    return await this.state.enqueueAction(input)
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt = new Date().toISOString()): Promise<void> {
    await this.state.decideApproval(approvalId, decision, metadata, decidedAt)
  }
}
