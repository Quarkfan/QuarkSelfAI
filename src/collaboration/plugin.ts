import { Context, Service } from '@deepseek-ai/cordis'
import { CollaborationLearningEngine } from './engine.js'
import type { CollaborationDailyReview, CollaborationLearningConfig, CollaborationMessage, CollaborationPolicyProposal, CollaborationTaskDecision } from './types.js'
import type { DurablePolicyStatePort } from '../storage/service-contract.js'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import { eventToPolicySample } from './policy-samples.js'
import type { DurableWorkflowPort } from '../workflow/contracts.js'
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
  static inject = [
    'quarkSignalState', 'quarkCheckpointState', 'quarkEventQueryState', 'quarkPolicyState', 'quarkWorkflows',
  ]
  private readonly engine: CollaborationLearningEngine
  private readonly policyState: DurablePolicyStatePort
  private readonly workflows: DurableWorkflowPort
  private readonly scheduleDefinition
  private readonly approvalDefinition

  constructor(ctx: Context, private readonly config: CollaborationLearningConfig = {}) {
    super(ctx, 'quarkCollaborationLearning')
    const signals = ctx.quarkSignalState
    const checkpoints = ctx.quarkCheckpointState
    const events = ctx.quarkEventQueryState
    this.policyState = ctx.quarkPolicyState
    this.workflows = ctx.quarkWorkflows
    this.scheduleDefinition = collaborationScheduleWorkflow(config.evaluationIntervalMs)
    this.approvalDefinition = collaborationPolicyApprovalWorkflow()
    this.engine = new CollaborationLearningEngine({
      appendSignal: input => signals.appendSignal(input),
      recentSignals: (kind, limit) => signals.recentSignals(kind, limit),
      readCheckpoint: (namespace, key) => checkpoints.readFeatureCheckpoint(namespace, key),
      writeCheckpoint: (namespace, key, value) => checkpoints.writeFeatureCheckpoint(namespace, key, value),
      recentPolicySamples: async limit => (await events.recentEventPayloads('message.received', limit)).map(eventToPolicySample),
      savePolicyDraft: input => this.policyState.savePolicyDraft(input),
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

  review(now?: Date): Promise<CollaborationDailyReview | undefined> {
    return this.engine.review(now)
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
    const review = await this.engine.review(new Date(evaluatedAt))
    if (!review) return { reviewed: false, evaluatedAt, briefEnabled: false }
    return {
      reviewed: true, evaluatedAt, proposed: review.proposal !== undefined,
      briefEnabled: this.config.dailyBriefEnabled !== false,
      briefTitle: review.briefTitle, briefBody: review.briefBody, reviewedAt: review.reviewedAt,
      decision: review.decision, sampleCount: review.sampleCount,
    }
  }

  private async applyDecision(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    const policyId = text(effect.payload.policyId, 'policyId')
    const revision = number(effect.payload.revision, 'revision')
    const decision = effect.payload.decision
    const decidedAt = timestamp(effect.payload.decidedAt, 'decidedAt')
    if (decision !== 'approve' && decision !== 'decline') throw new Error('collaboration policy decision is invalid')
    if (decision === 'approve') await this.policyState.activatePolicy(policyId, revision, decidedAt)
    await this.engine.recordPolicyDecision(policyId, decision, new Date(decidedAt))
    return { policyId, revision, decision }
  }
}

export const name = 'quark-collaboration-learning'
export const inject = [
  'quarkSignalState', 'quarkCheckpointState', 'quarkEventQueryState', 'quarkPolicyState', 'quarkWorkflows',
]

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
