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
  interface Events {
    /** Emitted only after a new normalized event is durable; consumers use it as a wake hint. */
    'quark/event-appended'(eventId: string): void
    /** Earliest durable workflow timer/effect that may now be actionable. */
    'quark/workflow-wake'(at?: string): void
    /** An approved durable action is ready now, or a retry becomes ready at this time. */
    'quark/action-wake'(at?: string): void
  }
}
