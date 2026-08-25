import type { DurableActionInput } from '../storage/types.js'

export interface ActionLedgerPort {
  enqueue(input: DurableActionInput): Promise<{ readonly inserted: boolean }>
  decideApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    metadata: Readonly<Record<string, unknown>>,
    decidedAt?: string,
  ): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context { quarkActionLedger: ActionLedgerPort }
}
