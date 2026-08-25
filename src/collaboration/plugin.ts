import { Context, Service } from '@deepseek-ai/cordis'
import { CollaborationLearningEngine } from './engine.js'
import type { CollaborationLearningConfig, CollaborationMessage, CollaborationPolicyProposal, CollaborationTaskDecision } from './types.js'
import type { DurableStatePort } from '../storage/service-contract.js'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type { DurableWorkflowRuntime } from '../workflow/runtime.js'
import {
  COLLABORATION_EFFECTS, COLLABORATION_POLICY_APPROVAL_KIND, COLLABORATION_SCHEDULE_ID,
  collaborationPolicyApprovalWorkflow, collaborationScheduleWorkflow,
} from './workflow.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkCollaborationLearning: CollaborationLearningService
  }
}

export class CollaborationLearningService extends Service {
  static inject = ['quarkState', 'quarkWorkflows']
  private readonly engine: CollaborationLearningEngine
  private readonly state: DurableStatePort
  private readonly workflows: DurableWorkflowRuntime
  private readonly scheduleDefinition
  private readonly approvalDefinition

  constructor(ctx: Context, private readonly config: CollaborationLearningConfig = {}) {
    super(ctx, 'quarkCollaborationLearning')
    this.state = ctx.quarkState
    this.workflows = ctx.quarkWorkflows
    this.scheduleDefinition = collaborationScheduleWorkflow(config.evaluationIntervalMs)
    this.approvalDefinition = collaborationPolicyApprovalWorkflow()
    this.engine = new CollaborationLearningEngine({
      appendSignal: input => this.state.appendSignal(input),
      recentSignals: (kind, limit) => this.state.recentSignals(kind, limit),
      readCheckpoint: (namespace, key) => this.state.readFeatureCheckpoint(namespace, key),
      writeCheckpoint: (namespace, key, value) => this.state.writeFeatureCheckpoint(namespace, key, value),
      recentPolicySamples: limit => this.state.recentPolicySamples(limit),
      savePolicyDraft: input => this.state.savePolicyDraft(input),
      publishProposal: proposal => this.openApproval(proposal),
    }, config)
    const disposers = [
      this.workflows.register(this.scheduleDefinition),
      this.workflows.register(this.approvalDefinition),
      this.workflows.registerEffect(COLLABORATION_EFFECTS.evaluate, { execute: effect => this.evaluate(effect) }),
      this.workflows.registerEffect(COLLABORATION_EFFECTS.applyDecision, { execute: effect => this.applyDecision(effect) }),
    ]
    ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() }, 'quark collaboration learning workflows')
  }

  observe(message: CollaborationMessage, task: CollaborationTaskDecision, now?: Date): Promise<boolean> {
    return this.engine.observe(message, task, now)
  }

  recordOwnerMessage(messageId: string, text: string, explicitReply: boolean, now?: Date): Promise<boolean> {
    return this.engine.recordOwnerMessage(messageId, text, explicitReply, now)
  }

  recordPolicyDecision(policyId: string, decision: 'approve' | 'decline', now?: Date): Promise<boolean> {
    return this.engine.recordPolicyDecision(policyId, decision, now)
  }

  guidanceFor(message: CollaborationMessage): Promise<string> {
    return this.engine.guidanceFor(message)
  }

  poll(now?: Date): Promise<CollaborationPolicyProposal | undefined> {
    return this.engine.poll(now)
  }

  async start(now = new Date()): Promise<void> {
    if (this.config.enabled !== true) return
    await this.workflows.ensure(COLLABORATION_SCHEDULE_ID, this.scheduleDefinition.kind, {}, now)
  }

  private async openApproval(proposal: CollaborationPolicyProposal): Promise<void> {
    await this.workflows.ensure(`collaboration-policy:${proposal.id}`, COLLABORATION_POLICY_APPROVAL_KIND, { proposal })
  }

  private async evaluate(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    const evaluatedAt = timestamp(effect.payload.evaluatedAt, 'evaluatedAt')
    const proposal = await this.engine.poll(new Date(evaluatedAt))
    return { proposed: proposal !== undefined, evaluatedAt }
  }

  private async applyDecision(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    const policyId = text(effect.payload.policyId, 'policyId')
    const revision = number(effect.payload.revision, 'revision')
    const decision = effect.payload.decision
    const decidedAt = timestamp(effect.payload.decidedAt, 'decidedAt')
    if (decision !== 'approve' && decision !== 'decline') throw new Error('collaboration policy decision is invalid')
    if (decision === 'approve') await this.state.activatePolicy(policyId, revision, decidedAt)
    await this.engine.recordPolicyDecision(policyId, decision, new Date(decidedAt))
    return { policyId, revision, decision }
  }
}

export const name = 'quark-collaboration-learning'
export const inject = ['quarkState', 'quarkWorkflows']

export async function apply(ctx: Context, config: CollaborationLearningConfig = {}): Promise<void> {
  await ctx.plugin(CollaborationLearningService, config)
  await ctx.quarkCollaborationLearning.start()
}

export * from './engine.js'
export * from './types.js'
export * from './workflow.js'

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`${label} is invalid`)
  return value
}
function number(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`)
  return Number(value)
}
function timestamp(value: unknown, label: string): string {
  const result = text(value, label)
  if (Number.isNaN(new Date(result).getTime())) throw new Error(`${label} is invalid`)
  return result
}
