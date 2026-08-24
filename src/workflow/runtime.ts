import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ClaimedWorkflowEffect,
  WorkflowEffectInput,
  WorkflowInstance,
  WorkflowStatus,
} from '../storage/types.js'
import type {} from '../storage/service.js'

export interface WorkflowEvent {
  readonly id: string
  readonly type: string
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface WorkflowDecision {
  readonly status: WorkflowStatus
  readonly state: Readonly<Record<string, unknown>>
  readonly wakeAt?: string
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

export interface WorkflowRuntimeConfig {
  readonly workerId: string
  readonly enabled?: boolean
  readonly pollIntervalMs?: number
  readonly leaseMs?: number
  readonly retryDelayMs?: number
  readonly maxAttempts?: number
  readonly batchSize?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkWorkflows: DurableWorkflowRuntime
  }
}

export class DurableWorkflowRuntime extends Service {
  private readonly definitions = new Map<string, WorkflowDefinition>()
  private readonly effectHandlers = new Map<string, WorkflowEffectHandler>()
  private running = false

  constructor(ctx: Context, private readonly config: WorkflowRuntimeConfig) {
    super(ctx, 'quarkWorkflows')
    if (!config.workerId?.trim()) throw new Error('workflow runtime workerId is required')
    if (config.enabled === true) {
      const timer = setInterval(() => void this.runOnce().catch(error => ctx.logger('quark-workflows').error(error)), config.pollIntervalMs ?? 30_000)
      timer.unref()
      ctx.effect(() => () => clearInterval(timer), 'quark durable workflow timer')
    }
  }

  register(definition: WorkflowDefinition): () => void {
    if (!definition.kind.trim() || !Number.isSafeInteger(definition.version) || definition.version < 1) {
      throw new Error('workflow definition requires a kind and positive integer version')
    }
    if (this.definitions.has(definition.kind)) throw new Error(`workflow definition ${definition.kind} is already registered`)
    this.definitions.set(definition.kind, definition)
    return () => this.definitions.delete(definition.kind)
  }

  registerEffect(kind: string, handler: WorkflowEffectHandler): () => void {
    if (!kind.trim()) throw new Error('workflow effect kind is required')
    if (this.effectHandlers.has(kind)) throw new Error(`workflow effect handler ${kind} is already registered`)
    this.effectHandlers.set(kind, handler)
    return () => this.effectHandlers.delete(kind)
  }

  async start(id: string, kind: string, input: Readonly<Record<string, unknown>>, now = new Date()): Promise<WorkflowInstance> {
    const definition = this.definition(kind)
    const decision = validateDecision(definition.initialize(input, now.toISOString()))
    return (await this.ctx.quarkState.createWorkflow({
      id, kind, definitionVersion: definition.version, status: decision.status,
      state: decision.state, ...(decision.wakeAt ? { wakeAt: decision.wakeAt } : {}),
      ...(decision.effects ? { effects: decision.effects } : {}),
    })).instance
  }

  async ensure(id: string, kind: string, input: Readonly<Record<string, unknown>>, now = new Date()): Promise<WorkflowInstance> {
    const existing = await this.ctx.quarkState.workflow(id)
    if (!existing) return await this.start(id, kind, input, now)
    const definition = this.definition(kind)
    if (existing.kind !== kind || existing.definitionVersion !== definition.version) {
      throw new Error(`workflow ${id} already belongs to ${existing.kind}@${existing.definitionVersion}`)
    }
    return existing
  }

  async dispatch(instanceId: string, event: WorkflowEvent): Promise<WorkflowInstance> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const instance = await this.ctx.quarkState.workflow(instanceId)
      if (!instance) throw new Error(`workflow ${instanceId} does not exist`)
      const definition = this.definition(instance.kind)
      if (definition.version !== instance.definitionVersion) {
        throw new Error(`workflow ${instanceId} requires definition ${instance.kind}@${instance.definitionVersion}`)
      }
      const decision = validateDecision(definition.reduce(instance.state, event))
      try {
        return (await this.ctx.quarkState.advanceWorkflow({
          instanceId, expectedRevision: instance.revision, event,
          status: decision.status, state: decision.state,
          ...(decision.wakeAt ? { wakeAt: decision.wakeAt } : {}),
          ...(decision.effects ? { effects: decision.effects } : {}),
        })).instance
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('revision conflict') || attempt === 2) throw error
      }
    }
    throw new Error(`workflow ${instanceId} could not advance`)
  }

  async runOnce(now = new Date()): Promise<{ readonly due: number; readonly effect: 'idle' | 'delivered' | 'deferred' | 'failed' }> {
    if (this.running) return { due: 0, effect: 'idle' }
    this.running = true
    try {
      const timestamp = now.toISOString()
      const due = await this.ctx.quarkState.dueWorkflows(timestamp, this.config.batchSize ?? 20)
      for (const instance of due) {
        const scheduledAt = instance.wakeAt
        if (!scheduledAt) continue
        await this.dispatch(instance.id, {
          id: `timer:${scheduledAt}`, type: 'timer', occurredAt: timestamp, payload: { scheduledAt },
        })
      }
      const effect = await this.ctx.quarkState.claimNextWorkflowEffect(
        this.config.workerId,
        timestamp,
        new Date(now.getTime() + (this.config.leaseMs ?? 120_000)).toISOString(),
      )
      if (!effect) return { due: due.length, effect: 'idle' }
      const handler = this.effectHandlers.get(effect.kind)
      if (!handler) {
        await this.ctx.quarkState.releaseWorkflowEffect(effect.id, this.config.workerId, `no handler registered for ${effect.kind}`,
          new Date(now.getTime() + (this.config.retryDelayMs ?? 120_000)).toISOString(), false)
        return { due: due.length, effect: 'deferred' }
      }
      try {
        const output = await handler.execute(effect)
        if (output !== undefined && (typeof output !== 'object' || output === null || Array.isArray(output))) {
          throw new Error(`workflow effect handler ${effect.kind} returned a non-object result`)
        }
        const deliveredAt = new Date().toISOString()
        await this.dispatch(effect.instanceId, {
          id: `effect:${effect.id}:delivered`, type: 'effect.delivered', occurredAt: deliveredAt,
          payload: { ...(output ?? {}), effectId: effect.id, effectKind: effect.kind },
        })
        await this.ctx.quarkState.settleWorkflowEffect(effect.id, this.config.workerId, deliveredAt)
        return { due: due.length, effect: 'delivered' }
      } catch (error) {
        const terminal = effect.attempt >= (this.config.maxAttempts ?? 5)
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 4_096)
        let transitionError: unknown
        if (terminal) {
          try {
            await this.dispatch(effect.instanceId, {
              id: `effect:${effect.id}:failed`, type: 'effect.failed', occurredAt: new Date().toISOString(),
              payload: { effectId: effect.id, effectKind: effect.kind, error: message },
            })
          } catch (dispatchError) {
            transitionError = dispatchError
          }
        }
        await this.ctx.quarkState.releaseWorkflowEffect(effect.id, this.config.workerId, message,
          new Date(now.getTime() + (this.config.retryDelayMs ?? 120_000)).toISOString(), terminal)
        if (transitionError) throw transitionError
        return { due: due.length, effect: terminal ? 'failed' : 'deferred' }
      }
    } finally {
      this.running = false
    }
  }

  private definition(kind: string): WorkflowDefinition {
    const definition = this.definitions.get(kind)
    if (!definition) throw new Error(`workflow definition ${kind} is not registered`)
    return definition
  }
}

function validateDecision(decision: WorkflowDecision): WorkflowDecision {
  if (!['running', 'waiting', 'completed', 'failed'].includes(decision.status)) throw new Error(`invalid workflow status ${decision.status}`)
  if (typeof decision.state !== 'object' || decision.state === null || Array.isArray(decision.state)) throw new Error('workflow state must be an object')
  assertJsonValue(decision.state, 'workflow state')
  if (decision.wakeAt && Number.isNaN(new Date(decision.wakeAt).getTime())) throw new Error('workflow wakeAt must be an ISO timestamp')
  const ids = (decision.effects ?? []).map(effect => effect.id)
  if (new Set(ids).size !== ids.length) throw new Error('workflow effect ids must be unique within a decision')
  for (const effect of decision.effects ?? []) {
    if (!effect.id.trim() || !effect.kind.trim()) throw new Error('workflow effects require non-empty id and kind')
    if (effect.availableAt && Number.isNaN(new Date(effect.availableAt).getTime())) throw new Error(`workflow effect ${effect.id} has invalid availableAt`)
    assertJsonValue(effect.payload, `workflow effect ${effect.id} payload`)
  }
  return decision
}

function assertJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`))
    return
  }
  if (typeof value !== 'object') throw new Error(`${path} contains a non-JSON value`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} contains a non-plain object`)
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) assertJsonValue(item, `${path}.${key}`)
}
