import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type {} from '../events/runtime.js'
import type { DurableEventRuntime } from '../events/runtime.js'
import type { DurableStatePort } from '../storage/service-contract.js'
import type { DurableWorkflowRuntime } from '../workflow/runtime.js'
import { FOCUS_DISCOVERY_WORKFLOW_ID, FOCUS_DISCOVERY_WORKFLOW_KIND, focusDiscoveryWorkflow } from './discovery-workflow.js'
import { INTAKE_WORKFLOW_KIND, messageIntakeWorkflow } from './workflow.js'
import { FOCUS_DISCOVERY_EVENT_KEY, type FocusDiscoverySources, type IntakePluginConfig, type IntakeRoute } from './types.js'

declare module '@deepseek-ai/cordis' { interface Context { quarkIntake: IntakeService } }

export class IntakeService extends Service {
  static inject = ['quarkEvents', 'quarkWorkflows', 'quarkState']
  private readonly definition = messageIntakeWorkflow()
  private readonly discoveryDefinition = focusDiscoveryWorkflow()
  private readonly state: DurableStatePort
  private readonly workflows: DurableWorkflowRuntime
  constructor(ctx: Context, private readonly config: IntakePluginConfig) {
    super(ctx, 'quarkIntake')
    if (!config.ownerOpenId?.trim() || !config.workspace?.trim()) throw new Error('intake ownerOpenId and workspace are required')
    if (config.enabled === true && !config.taskProjection) throw new Error('enabled intake requires taskProjection authorization')
    this.state = ctx.quarkState
    this.workflows = ctx.quarkWorkflows
    const events: DurableEventRuntime = ctx.quarkEvents
    const disposeDefinition = this.workflows.register(this.definition)
    const disposeDiscoveryDefinition = this.workflows.register(this.discoveryDefinition)
    const disposeConsumer = events.register({
      name: 'message-intake', eventKeys: [
        'im.message.receive_v1', 'card.action.trigger', 'im.chat.member.user.added_v1',
        'im.message.reaction.created_v1', 'im.message.reaction.deleted_v1', FOCUS_DISCOVERY_EVENT_KEY,
      ], handle: event => this.handle(event),
    })
    ctx.effect(() => () => { disposeConsumer(); disposeDiscoveryDefinition(); disposeDefinition() }, 'quark message intake')
  }
  async ensureDiscovery(): Promise<void> {
    if (this.config.enabled !== true) return
    const sources: FocusDiscoverySources = {
      ownerOpenId: this.config.ownerOpenId,
      senderIds: this.config.focusSenderIds ?? [],
      conversationIds: this.config.focusConversationIds ?? [],
      includeOwnerParticipation: this.config.monitorOwnerParticipation !== false,
      includeFlaggedConversations: this.config.monitorFlaggedConversations !== false,
      includeDirectMessages: this.config.monitorDirectMessages !== false,
      includeMentionBackfill: this.config.monitorMentionBackfill !== false,
      feedGroupNames: this.config.focusFeedGroupNames ?? ['特别关注'],
    }
    const input = {
      intervalMs: this.config.discoveryIntervalMs ?? 10 * 60_000,
      overlapMs: this.config.discoveryOverlapMs ?? 2 * 60_000,
      retryMs: this.config.discoveryRetryMs ?? 10 * 60_000,
      sources,
    }
    const existing = await this.state.workflow(FOCUS_DISCOVERY_WORKFLOW_ID)
    if (existing) {
      if (existing.kind !== FOCUS_DISCOVERY_WORKFLOW_KIND || existing.definitionVersion !== this.discoveryDefinition.version) {
        throw new Error(`workflow ${FOCUS_DISCOVERY_WORKFLOW_ID} already belongs to ${existing.kind}@${existing.definitionVersion}`)
      }
      return
    }
    const now = new Date().toISOString()
    const decision = this.discoveryDefinition.initialize(input, now)
    await this.state.createWorkflow({
      id: FOCUS_DISCOVERY_WORKFLOW_ID,
      kind: FOCUS_DISCOVERY_WORKFLOW_KIND,
      definitionVersion: this.discoveryDefinition.version,
      status: decision.status,
      state: decision.state,
      ...(decision.wakeAt ? { wakeAt: decision.wakeAt } : {}),
      ...(decision.effects ? { effects: decision.effects } : {}),
    })
  }
  async [Service.init](): Promise<void> { await this.ensureDiscovery() }
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
    const trustedDiscovery = event.eventKey === FOCUS_DISCOVERY_EVENT_KEY
    return mentioned || focusedSender || focusedConversation || trustedDiscovery ? 'focus' : undefined
  }
  private workflowId(event: NormalizedChannelEvent): string {
    return `message-intake:${createHash('sha256').update(event.deduplicationKey).digest('hex').slice(0, 32)}`
  }
  private start(event: NormalizedChannelEvent, route: IntakeRoute) {
    return this.workflows.ensure(this.workflowId(event), INTAKE_WORKFLOW_KIND, { route, event, workspace: this.config.workspace, ...(this.config.taskProjection ? { taskProjection: this.config.taskProjection } : {}) })
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
export const inject = ['quarkEvents', 'quarkWorkflows', 'quarkState']
export async function apply(ctx: Context, config: IntakePluginConfig): Promise<void> { await ctx.plugin(IntakeService, config) }
export * from './types.js'
export * from './workflow.js'
export * from './discovery-workflow.js'
