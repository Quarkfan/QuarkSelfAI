import type { DurableActionInput } from '../storage/types.js'

export interface ActionLedgerPort {
  enqueue(input: DurableActionInput): Promise<{ readonly inserted: boolean }>
}

declare module '@deepseek-ai/cordis' {
  interface Context { quarkActionLedger: ActionLedgerPort }
}
