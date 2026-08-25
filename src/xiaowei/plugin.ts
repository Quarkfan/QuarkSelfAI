import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkflowInstance } from '../storage/types.js'
import type { DurableWorkflowPort } from '../workflow/contracts.js'
import type { XiaoweiReplyInput, XiaoweiResearchConfig, XiaoweiResearchInput } from './types.js'
import { xiaoweiResearchWorkflow } from './workflow.js'

declare module '@deepseek-ai/cordis' { interface Context { quarkXiaoweiResearch: XiaoweiResearchService } }
export class XiaoweiResearchService extends Service {
  static inject = ['quarkWorkflows']
  private readonly definition
  private readonly workflows: DurableWorkflowPort
  constructor(ctx: Context, private readonly config: XiaoweiResearchConfig) {
    super(ctx, 'quarkXiaoweiResearch')
    this.workflows = ctx.quarkWorkflows
    this.definition = xiaoweiResearchWorkflow(config)
    const dispose = ctx.quarkWorkflows.register(this.definition)
    ctx.effect(() => dispose, 'quark Xiaowei research definition')
  }
  async request(input: XiaoweiResearchInput, now = new Date()): Promise<WorkflowInstance> {
    if (this.config.enabled !== true) throw new Error('native Xiaowei research is not enabled')
    return await this.workflows.ensure(`xiaowei-research:${input.requestId}`, this.definition.kind, input, now)
  }
  async receiveReply(requestId: string, reply: XiaoweiReplyInput): Promise<WorkflowInstance> {
    if (this.config.enabled !== true) throw new Error('native Xiaowei research is not enabled')
    return await this.workflows.dispatch(`xiaowei-research:${requestId}`, {
      id: `xiaowei-reply:${reply.messageId}`, type: 'xiaowei.reply', occurredAt: reply.receivedAt,
      payload: { messageId: reply.messageId, content: reply.content, ...(reply.url ? { url: reply.url } : {}) },
    })
  }
}
export const name = 'quark-xiaowei-research'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: XiaoweiResearchConfig): void { ctx.plugin(XiaoweiResearchService, config) }
export * from './types.js'
export * from './workflow.js'
