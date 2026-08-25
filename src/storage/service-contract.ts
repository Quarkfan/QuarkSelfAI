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

/** Narrow DSH-facing capability ports. One provider may implement all of them. */
export interface DurableEventAppendStatePort {
  appendEvent(event: NormalizedChannelEvent): Promise<StoredEvent>
}
export type DurableEventConsumerStatePort = Pick<EventJournalStorePort,
  'claimNextEvent' | 'settleEvent' | 'releaseEvent' | 'updateCheckpoint'>
export type DurableEventQueryStatePort = Pick<EventJournalStorePort, 'recentEventPayloads'>
export type DurableWorkflowStatePort = WorkflowStorePort
export type DurableActionEnqueueStatePort = Pick<ActionStorePort, 'enqueueAction'>
export type DurableActionDecisionStatePort = Pick<ActionStorePort, 'decideApproval'>
export type DurableActionWorkerStatePort = Pick<ActionStorePort, 'claimNextAction' | 'settleAction' | 'releaseActionClaim'>
export type DurableSignalStatePort = SignalStorePort
export type DurableCheckpointStatePort = FeatureCheckpointStorePort
export type DurablePolicyStatePort = Pick<PolicyStorePort, 'savePolicyDraft' | 'activatePolicy'>

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkEventAppendState: DurableEventAppendStatePort
    quarkEventConsumerState: DurableEventConsumerStatePort
    quarkEventQueryState: DurableEventQueryStatePort
    quarkWorkflowState: DurableWorkflowStatePort
    quarkActionEnqueueState: DurableActionEnqueueStatePort
    quarkActionDecisionState: DurableActionDecisionStatePort
    quarkActionWorkerState: DurableActionWorkerStatePort
    quarkSignalState: DurableSignalStatePort
    quarkCheckpointState: DurableCheckpointStatePort
    quarkPolicyState: DurablePolicyStatePort
  }
  interface Events {
    /** A new durable event is ready now, or a failed delivery becomes ready at this time. */
    'quark/event-wake'(at?: string): void
    /** Earliest durable workflow timer/effect that may now be actionable. */
    'quark/workflow-wake'(at?: string): void
    /** An approved durable action is ready now, or a retry becomes ready at this time. */
    'quark/action-wake'(at?: string): void
  }
}
