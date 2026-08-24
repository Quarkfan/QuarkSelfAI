import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type {} from '../events/runtime.js'
import type {} from '../workflow/runtime.js'
import { INTAKE_WORKFLOW_KIND, messageIntakeWorkflow } from './workflow.js'
import type { IntakePluginConfig, IntakeRoute } from './types.js'

declare module '@deepseek-ai/cordis' { interface Context { quarkIntake: IntakeService } }

export class IntakeService extends Service {
  private readonly definition = messageIntakeWorkflow()
  constructor(ctx: Context, private readonly config: IntakePluginConfig) {
    super(ctx, 'quarkIntake')
    if (!config.ownerOpenId?.trim() || !config.workspace?.trim()) throw new Error('intake ownerOpenId and workspace are required')
    const disposeDefinition = ctx.quarkWorkflows.register(this.definition)
    const disposeConsumer = ctx.quarkEvents.register({
      name: 'message-intake', eventKeys: [
        'im.message.receive_v1', 'card.action.trigger', 'im.chat.member.user.added_v1',
        'im.message.reaction.created_v1', 'im.message.reaction.deleted_v1',
      ], handle: event => this.handle(event),
    })
    ctx.effect(() => () => { disposeConsumer(); disposeDefinition() }, 'quark message intake')
  }
  async handle(event: NormalizedChannelEvent): Promise<void> {
    if (this.config.enabled !== true) return
    if (event.kind === 'card.action') {
      if (event.payload.operatorId !== this.config.ownerOpenId) return
      await this.start(event, 'interaction')
      return
    }
    if (event.kind === 'message.received') { await this.handleMessage(event); return }
    if (this.isDelegatedMembership(event) || this.isOwnerReaction(event)) await this.start(event, 'focus')
  }
  async handleMessage(event: NormalizedChannelEvent): Promise<void> {
    if (event.kind !== 'message.received') return
    const route = this.route(event)
    if (!route) return
    await this.start(event, route)
  }
  private route(event: NormalizedChannelEvent): IntakeRoute | undefined {
    const owner = event.source.senderId === this.config.ownerOpenId
    if (owner && event.payload.chatType === 'p2p') return 'owner-command'
    if (owner || event.payload.chatType === 'p2p') return 'focus'
    const mentions = Array.isArray(event.payload.mentions) ? event.payload.mentions : []
    const mentioned = mentions.some(item => isRecord(item) && mentionIds(item).includes(this.config.ownerOpenId))
    const focusedSender = event.source.senderId !== undefined && (this.config.focusSenderIds ?? []).includes(event.source.senderId)
    const focusedConversation = event.source.conversationId !== undefined && (this.config.focusConversationIds ?? []).includes(event.source.conversationId)
    return mentioned || focusedSender || focusedConversation ? 'focus' : undefined
  }
  private workflowId(event: NormalizedChannelEvent): string {
    return `message-intake:${createHash('sha256').update(event.deduplicationKey).digest('hex').slice(0, 32)}`
  }
  private start(event: NormalizedChannelEvent, route: IntakeRoute) {
    return this.ctx.quarkWorkflows.ensure(this.workflowId(event), INTAKE_WORKFLOW_KIND, { route, event, workspace: this.config.workspace })
  }
  private isDelegatedMembership(event: NormalizedChannelEvent): boolean {
    if (event.eventKey !== 'im.chat.member.user.added_v1' || !this.config.delegationInviterId) return false
    const payload = event.payload.event
    if (!isRecord(payload) || !isRecord(payload.operator_id) || payload.operator_id.open_id !== this.config.delegationInviterId) return false
    return Array.isArray(payload.users) && payload.users.some(user => isRecord(user) && isRecord(user.user_id) && user.user_id.open_id === this.config.ownerOpenId)
  }
  private isOwnerReaction(event: NormalizedChannelEvent): boolean {
    if (!event.eventKey.startsWith('im.message.reaction.')) return false
    const payload = event.payload.event
    return isRecord(payload) && isRecord(payload.user_id) && payload.user_id.open_id === this.config.ownerOpenId
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function mentionIds(value: Record<string, unknown>): readonly unknown[] {
  const id = isRecord(value.id) ? value.id : {}
  return [value.id, value.open_id, value.openId, id.open_id, id.openId]
}

export const name = 'quark-message-intake'
export const inject = ['quarkEvents', 'quarkWorkflows']
export async function apply(ctx: Context, config: IntakePluginConfig): Promise<void> { await ctx.plugin(IntakeService, config) }
export * from './types.js'
export * from './workflow.js'
