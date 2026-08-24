import type { Context } from '@deepseek-ai/cordis'
import { ActionLedgerService, type ActionLedgerConfig } from './ledger-service.js'

export const name = 'quark-action-ledger'
export const inject = ['quarkExecutors', 'quarkState']

export function apply(ctx: Context, config: ActionLedgerConfig): void {
  ctx.plugin(ActionLedgerService, config)
}

export * from './ledger-service.js'
