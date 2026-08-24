import type { Context } from '@deepseek-ai/cordis'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type {} from '../workflow/runtime.js'
import { LARK_EFFECTS } from './effects.js'
import { ProcessCommandRunner, runJson, type CommandRunner } from './runner.js'

export interface FeishuContextEffectConfig { readonly executable?: string }

export class FeishuContextEffectAdapter {
  constructor(private readonly config: FeishuContextEffectConfig = {}, private readonly runner: CommandRunner = new ProcessCommandRunner()) {}

  async execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    if (effect.kind !== LARK_EFFECTS.loadMessageContext) throw new Error(`unsupported Feishu context effect ${effect.kind}`)
    const event = object(effect.payload.event, 'context source event')
    const source = object(event.source, 'context source')
    const payload = object(event.payload, 'context event payload')
    const chatId = required(source.conversationId, 'context conversationId', 300)
    const targetAt = time(event.occurredAt, effect.payload.requestedAt)
    const nearby = await this.chatMessages(chatId, new Date(targetAt.getTime() - 30 * 60_000), new Date(targetAt.getTime() + 30 * 60_000), 'asc')
    const latest = Date.now() > targetAt.getTime() + 30 * 60_000 ? await this.chatMessages(chatId, targetAt, new Date(), 'desc') : []
    const messages = compactMessages([...nearby, ...latest.reverse()])
    const chatType = optional(payload.chatType, 'chatType', 30)
    const externalGroup = chatType === 'p2p' ? false : await this.externalGroup(chatId)
    return { context: { messages, externalGroup, relationship: chatType === 'p2p' ? 'direct-message' : 'group' } }
  }

  private async chatMessages(chatId: string, start: Date, end: Date, order: 'asc' | 'desc') {
    const envelope = await runJson(this.runner, this.config.executable ?? 'lark-cli', [
      'im', '+chat-messages-list', '--as', 'user', '--chat-id', chatId,
      '--start', start.toISOString(), '--end', end.toISOString(), '--order', order,
      '--page-size', '50', '--page-limit', '3', '--no-reactions', '--format', 'json',
    ])
    const data = object(object(envelope, 'lark-cli response').data, 'lark-cli response data')
    if (!Array.isArray(data.messages)) throw new Error('chat message context must contain messages')
    return data.messages.map((value, index) => object(value, `context message ${index}`))
  }

  private async externalGroup(chatId: string): Promise<boolean | 'unknown'> {
    const envelope = await runJson(this.runner, this.config.executable ?? 'lark-cli', [
      'im', 'chats', 'get', '--as', 'user', '--chat-id', chatId, '--format', 'json',
    ])
    const data = object(object(envelope, 'lark-cli response').data, 'lark-cli response data')
    const value = data.external ?? data.is_external ?? data.isCrossTenant
    return typeof value === 'boolean' ? value : 'unknown'
  }
}

export const name = 'quark-feishu-context-effects'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: FeishuContextEffectConfig): void {
  const adapter = new FeishuContextEffectAdapter(config)
  const dispose = ctx.quarkWorkflows.registerEffect(LARK_EFFECTS.loadMessageContext, { execute: effect => adapter.execute(effect) })
  ctx.effect(() => dispose, 'quark Feishu context effects')
}

function required(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); if (value.length > max) throw new Error(`${label} exceeds ${max} characters`); return value }
function optional(value: unknown, label: string, max: number): string | undefined { return value === undefined || value === null || value === '' ? undefined : required(value, label, max) }
function object(value: unknown, label: string): Readonly<Record<string, unknown>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Readonly<Record<string, unknown>> }
function time(...values: readonly unknown[]): Date { for (const value of values) { if (typeof value !== 'string') continue; const parsed = new Date(value); if (!Number.isNaN(parsed.getTime())) return parsed } throw new Error('context event timestamp is required') }
function compactMessages(values: readonly Readonly<Record<string, unknown>>[]): readonly Readonly<Record<string, unknown>>[] {
  const byId = new Map<string, Readonly<Record<string, unknown>>>()
  for (const [index, value] of values.entries()) {
    const id = optional(value.message_id ?? value.messageId, `context message ${index} id`, 300) ?? `position:${index}`
    byId.set(id, {
      messageId: id,
      ...(typeof value.sender_id === 'string' ? { senderId: value.sender_id } : {}),
      ...(typeof value.sender_name === 'string' ? { senderName: value.sender_name } : {}),
      ...(typeof value.create_time === 'string' ? { createdAt: value.create_time } : {}),
      ...(typeof value.content === 'string' ? { content: value.content.slice(0, 8_000) } : {}),
      ...(typeof value.message_type === 'string' ? { messageType: value.message_type } : {}),
    })
  }
  return [...byId.values()].slice(-150)
}
