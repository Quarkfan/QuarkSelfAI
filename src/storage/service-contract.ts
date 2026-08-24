import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type { AssistantStore, StoredEvent } from './types.js'

type ForwardedDurableStateMethod =
  | 'claimNextEvent'
  | 'claimNextEvent'
  | 'settleEvent'
  | 'releaseEvent'
  | 'updateCheckpoint'
  | 'appendSignal'
  | 'recentSignals'
  | 'readFeatureCheckpoint'
  | 'writeFeatureCheckpoint'
  | 'recentPolicySamples'
  | 'savePolicyDraft'
  | 'enqueueAction'
  | 'decideApproval'
  | 'claimNextAction'
  | 'settleAction'
  | 'releaseActionClaim'
  | 'createWorkflow'
  | 'workflow'
  | 'dueWorkflows'
  | 'advanceWorkflow'
  | 'claimNextWorkflowEffect'
  | 'settleWorkflowEffect'
  | 'releaseWorkflowEffect'

/** Stable DSH-facing state port. Concrete databases and connection ownership are replaceable providers. */
export interface DurableStatePort extends Pick<AssistantStore, ForwardedDurableStateMethod> {
  appendEvent(event: NormalizedChannelEvent): Promise<StoredEvent>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkState: DurableStatePort
  }
}
