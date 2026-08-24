import { Context, Service } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type { ClaimedWorkflowEffect, WorkflowInstance } from '../storage/types.js'
import type {} from '../workflow/runtime.js'
import { followupOutreachWorkflow } from './outreach-workflow.js'
import { followupReviewWorkflow } from './review-workflow.js'
import { FOLLOWUP_EFFECTS, type FollowupOutreachConfig, type FollowupOutreachInput, type FollowupReplyInput, type FollowupReviewConfig } from './types.js'

export interface FollowupPluginConfig extends FollowupReviewConfig, FollowupOutreachConfig {}
declare module '@deepseek-ai/cordis' { interface Context { quarkFollowup: FollowupService } }

export class FollowupService extends Service {
  private readonly reviewDefinition
  private readonly outreachDefinition
  constructor(ctx: Context, private readonly config: FollowupPluginConfig = {}) {
    super(ctx, 'quarkFollowup')
    this.reviewDefinition = followupReviewWorkflow(config)
    this.outreachDefinition = followupOutreachWorkflow(config)
    const disposeReview = ctx.quarkWorkflows.register(this.reviewDefinition)
    const disposeOutreach = ctx.quarkWorkflows.register(this.outreachDefinition)
    const disposeOpen = ctx.quarkWorkflows.registerEffect(FOLLOWUP_EFFECTS.openOutreach, { execute: effect => this.openFromEffect(effect) })
    ctx.effect(() => () => { disposeOpen(); disposeOutreach(); disposeReview() }, 'quark followup definitions')
  }
  async start(now = new Date()): Promise<WorkflowInstance> {
    if (this.config.enabled !== true) throw new Error('native followup is not enabled')
    return await this.ctx.quarkWorkflows.ensure('followup-review:automation', this.reviewDefinition.kind, {}, now)
  }
  async open(input: FollowupOutreachInput, now = new Date()): Promise<WorkflowInstance> {
    if (this.config.enabled !== true) throw new Error('native followup is not enabled')
    const initialized = this.outreachDefinition.initialize(input, now.toISOString())
    const requestId = String(initialized.state.requestId)
    return await this.ctx.quarkWorkflows.ensure(`followup-outreach:${requestId}`, this.outreachDefinition.kind, input, now)
  }
  chooseContact(requestId: string, openId: string, now = new Date()) { return this.dispatch(requestId, `contact:${openId}`, 'followup.contact-selected', now, { openId }) }
  queryContact(requestId: string, query: string, now = new Date()) { return this.dispatch(requestId, `query:${hash(query)}`, 'followup.contact-query', now, { query }) }
  decide(requestId: string, approvalId: string, decision: 'approved' | 'declined', now = new Date()) { return this.dispatch(requestId, `approval:${approvalId}:${decision}`, `approval.${decision}`, now, { approvalId }) }
  receiveReply(requestId: string, reply: FollowupReplyInput) { return this.dispatch(requestId, `reply:${reply.messageId}`, 'followup.reply', new Date(reply.receivedAt), { messageId: reply.messageId, content: reply.content, ...(reply.url ? { url: reply.url } : {}) }) }
  private dispatch(requestId: string, suffix: string, type: string, now: Date, payload: Readonly<Record<string, unknown>>) {
    if (this.config.enabled !== true) throw new Error('native followup is not enabled')
    return this.ctx.quarkWorkflows.dispatch(`followup-outreach:${requestId}`, { id: `followup:${requestId}:${suffix}`, type, occurredAt: now.toISOString(), payload })
  }
  private async openFromEffect(effect: ClaimedWorkflowEffect) { await this.open(effect.payload as FollowupOutreachInput); return { workflowId: `followup-outreach:${String((this.outreachDefinition.initialize(effect.payload, new Date().toISOString()).state).requestId)}` } }
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex').slice(0, 16) }
export const name = 'quark-followup'
export const inject = ['quarkWorkflows']
export async function apply(ctx: Context, config: FollowupPluginConfig = {}): Promise<void> { const fiber = ctx.plugin(FollowupService, config); await fiber; if (config.enabled === true) await ctx.quarkFollowup.start() }
export * from './types.js'
export * from './review-workflow.js'
export * from './outreach-workflow.js'
