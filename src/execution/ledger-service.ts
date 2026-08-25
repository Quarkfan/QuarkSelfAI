import { Context, Service } from '@deepseek-ai/cordis'
import type { DurableActionInput } from '../storage/types.js'
import type { DurableActionEnqueueStatePort } from '../storage/service-contract.js'
import type { ActionLedgerPort } from './ledger-contract.js'
export type { ActionLedgerPort } from './ledger-contract.js'

export interface ActionLedgerConfig {}

export class ActionLedgerService extends Service implements ActionLedgerPort {
  static inject = ['quarkActionEnqueueState']
  private readonly state: DurableActionEnqueueStatePort
  constructor(ctx: Context, _config: ActionLedgerConfig = {}) {
    super(ctx, 'quarkActionLedger')
    this.state = ctx.quarkActionEnqueueState
  }

  async enqueue(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    return await this.state.enqueueAction(input)
  }
}
