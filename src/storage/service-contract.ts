import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type {
  ActionStorePort,
  EventJournalStorePort,
  FeatureCheckpointStorePort,
  PolicyStorePort,
  SignalStorePort,
  StoredEvent,
  WorkflowStorePort,
} from './types.js'

/** Stable DSH-facing state port. Concrete databases and connection ownership are replaceable providers. */
export interface DurableStatePort extends
  Omit<EventJournalStorePort, 'appendEvent'>,
  SignalStorePort,
  FeatureCheckpointStorePort,
  WorkflowStorePort,
  ActionStorePort,
  Pick<PolicyStorePort, 'recentPolicySamples' | 'savePolicyDraft'> {
  appendEvent(event: NormalizedChannelEvent): Promise<StoredEvent>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkState: DurableStatePort
  }
}
