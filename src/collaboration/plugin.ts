import { Context, Service } from '@deepseek-ai/cordis'
import { CollaborationLearningEngine } from './engine.js'
import type { CollaborationLearningConfig, CollaborationMessage, CollaborationPolicyProposal, CollaborationTaskDecision } from './types.js'
import type {} from '../storage/service.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkCollaborationLearning: CollaborationLearningService
  }
  interface Events {
    'collaboration/policy-proposal'(proposal: CollaborationPolicyProposal): void | Promise<void>
  }
}

export class CollaborationLearningService extends Service {
  private readonly engine: CollaborationLearningEngine

  constructor(ctx: Context, config: CollaborationLearningConfig = {}) {
    super(ctx, 'quarkCollaborationLearning')
    this.engine = new CollaborationLearningEngine({
      appendSignal: input => ctx.quarkState.appendSignal(input),
      recentSignals: (kind, limit) => ctx.quarkState.recentSignals(kind, limit),
      readCheckpoint: (namespace, key) => ctx.quarkState.readFeatureCheckpoint(namespace, key),
      writeCheckpoint: (namespace, key, value) => ctx.quarkState.writeFeatureCheckpoint(namespace, key, value),
      recentPolicySamples: limit => ctx.quarkState.recentPolicySamples(limit),
      savePolicyDraft: input => ctx.quarkState.savePolicyDraft(input),
      publishProposal: proposal => ctx.parallel('collaboration/policy-proposal', proposal),
    }, config)
    if (config.enabled === true) {
      const timer = setInterval(() => void this.engine.poll().catch(error => ctx.logger('quark-collaboration-learning').error(error)), config.timerIntervalMs ?? 600_000)
      timer.unref()
      ctx.effect(() => () => clearInterval(timer), 'quark collaboration learning timer')
    }
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
}

export const name = 'quark-collaboration-learning'
export const inject = ['quarkState']

export function apply(ctx: Context, config: CollaborationLearningConfig = {}): void {
  ctx.plugin(CollaborationLearningService, config)
}

export * from './engine.js'
export * from './types.js'
