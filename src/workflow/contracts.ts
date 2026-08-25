import type {
  ClaimedWorkflowEffect,
  WorkflowEffectInput,
  WorkflowInstance,
  WorkflowStatus,
} from '../storage/types.js'

export interface WorkflowEvent {
  readonly id: string
  readonly type: string
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface WorkflowDecision {
  readonly status: WorkflowStatus
  readonly state: Readonly<Record<string, unknown>>
  /** undefined preserves the current wake-up, null clears it, and a timestamp reschedules it. */
  readonly wakeAt?: string | null
  readonly effects?: readonly WorkflowEffectInput[]
}

export interface WorkflowDefinition {
  readonly kind: string
  readonly version: number
  initialize(input: Readonly<Record<string, unknown>>, now: string): WorkflowDecision
  reduce(state: Readonly<Record<string, unknown>>, event: WorkflowEvent): WorkflowDecision
}

export interface WorkflowEffectHandler {
  execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>> | void>
}

export interface DurableWorkflowPort {
  register(definition: WorkflowDefinition): () => void
  registerEffect(kind: string, handler: WorkflowEffectHandler): () => void
  wake(at?: string): void
  workflow(id: string): Promise<WorkflowInstance | undefined>
  start(id: string, kind: string, input: Readonly<Record<string, unknown>>, now?: Date): Promise<WorkflowInstance>
  ensure(id: string, kind: string, input: Readonly<Record<string, unknown>>, now?: Date): Promise<WorkflowInstance>
  dispatch(instanceId: string, event: WorkflowEvent): Promise<WorkflowInstance>
}

declare module '@deepseek-ai/cordis' {
  interface Context { quarkWorkflows: DurableWorkflowPort }
}
