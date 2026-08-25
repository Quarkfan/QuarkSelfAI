import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkflowInstance } from '../storage/types.js'
import type { DurableWorkflowPort } from '../workflow/contracts.js'
import { sessionLifecycleWorkflow } from './workflow.js'
import type { SessionLifecycleConfig, TrackResearchSessionInput } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context { quarkSessionLifecycle: SessionLifecycleService }
}

export class SessionLifecycleService extends Service {
  static inject = ['quarkWorkflows']
  private readonly definition
  private readonly workflows: DurableWorkflowPort

  constructor(ctx: Context, private readonly config: SessionLifecycleConfig = {}) {
    super(ctx, 'quarkSessionLifecycle')
    this.workflows = ctx.quarkWorkflows
    this.definition = sessionLifecycleWorkflow(config)
    const dispose = ctx.quarkWorkflows.register(this.definition)
    ctx.effect(() => dispose, 'quark session lifecycle definition')
  }

  async track(input: TrackResearchSessionInput, now = new Date()): Promise<WorkflowInstance> {
    if (this.config.enabled !== true) throw new Error('native session lifecycle is not enabled')
    const instance = await this.workflows.ensure(`session-lifecycle:${input.sessionId}`, this.definition.kind, input, now)
    if (input.eligible !== false && instance.state.phase === 'waiting' && instance.state.eligible === false) {
      return await this.markEligible(input.sessionId, now)
    }
    return instance
  }

  async markEligible(sessionId: string, now = new Date()): Promise<WorkflowInstance> {
    if (this.config.enabled !== true) throw new Error('native session lifecycle is not enabled')
    const current = await this.workflows.workflow(`session-lifecycle:${sessionId}`)
    if (!current) throw new Error(`session lifecycle ${sessionId} is not tracked`)
    if (current.state.eligible === true || current.state.phase !== 'waiting') return current
    return await this.workflows.dispatch(`session-lifecycle:${sessionId}`, {
      id: `session-eligible:${sessionId}`, type: 'session.eligible', occurredAt: now.toISOString(), payload: {},
    })
  }
}

export const name = 'quark-session-lifecycle'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: SessionLifecycleConfig = {}): void { ctx.plugin(SessionLifecycleService, config) }
export * from './types.js'
export * from './workflow.js'
