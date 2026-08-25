import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type {} from '../workflow/contracts.js'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import { buildAssistantCard } from './cards.js'
import { LARK_EFFECTS } from './effects.js'
import { ProcessCommandRunner, runJson, type CommandRunner } from './runner.js'

export interface FeishuWorkflowEffectConfig {
  readonly executable?: string
  readonly ownerOpenId: string
}

export class FeishuWorkflowEffectAdapter {
  constructor(private readonly config: FeishuWorkflowEffectConfig, private readonly runner: CommandRunner = new ProcessCommandRunner()) {
    required(config.ownerOpenId, 'ownerOpenId', 300)
  }

  async execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    if (effect.kind === ASSISTANT_EFFECTS.notifyOwner || effect.kind === ASSISTANT_EFFECTS.requestInteraction) return await this.sendCard(effect)
    if (effect.kind === LARK_EFFECTS.sendAsUser) return await this.sendAsUser(effect)
    if (effect.kind === LARK_EFFECTS.resolveContact) return await this.resolveContact(effect)
    throw new Error(`unsupported Feishu workflow effect ${effect.kind}`)
  }

  private async resolveContact(effect: ClaimedWorkflowEffect) {
    const openId = optional(effect.payload.openId, 'openId', 300)
    const query = optional(effect.payload.query, 'query', 50)
    if (!openId && !query) throw new Error('contact resolution requires openId or query')
    const envelope = await runJson(this.runner, this.config.executable ?? 'lark-cli', [
      'contact', '+search-user', ...(openId ? ['--user-ids', openId] : ['--query', query!, '--has-chatted']),
      '--page-size', openId ? '5' : '20', '--as', 'user',
    ])
    const root = object(envelope, 'lark-cli response')
    if (root.ok !== true) throw new Error('lark-cli response was not successful')
    const data = object(root.data, 'lark-cli response data')
    if (!Array.isArray(data.users)) throw new Error('contact search users must be an array')
    const candidates = data.users.map((value, index) => {
      const user = object(value, `contact ${index}`)
      const id = required(user.open_id, `contact ${index} open_id`, 300)
      const department = optional(user.department, `contact ${index} department`, 500)
      const email = optional(user.enterprise_email, `contact ${index} enterprise_email`, 500) ?? optional(user.email, `contact ${index} email`, 500)
      return {
        openId: id, name: optional(user.localized_name, `contact ${index} name`, 300) ?? id,
        ...(department ? { department } : {}), ...(email ? { email } : {}), external: user.is_cross_tenant === true,
      }
    })
    return { candidates, hasMore: data.has_more === true }
  }

  private async sendCard(effect: ClaimedWorkflowEffect) {
    const data = await this.send([
      '--user-id', this.config.ownerOpenId, '--as', 'bot', '--msg-type', 'interactive',
      '--content', JSON.stringify(buildAssistantCard(effect)), '--idempotency-key', key(effect.payload.idempotencyKey ?? effect.id),
    ])
    return result(data)
  }

  private async sendAsUser(effect: ClaimedWorkflowEffect) {
    required(effect.payload.approvalId, 'send approvalId', 300)
    timestamp(effect.payload.approvedAt, 'send approvedAt')
    const chatId = optional(effect.payload.chatId, 'chatId', 300)
    const openId = optional(effect.payload.openId, 'openId', 300)
    if (!chatId && !openId) throw new Error('send-as-user requires chatId or openId')
    const content = required(effect.payload.content, 'send content', 12_000)
    const data = await this.send([
      ...(chatId ? ['--chat-id', chatId] : ['--user-id', openId!]), '--as', 'user', '--markdown', content,
      '--idempotency-key', key(effect.payload.idempotencyKey ?? effect.id),
    ])
    return { ...result(data), sentAt: new Date().toISOString() }
  }

  private async send(args: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
    const envelope = await runJson(this.runner, this.config.executable ?? 'lark-cli', ['im', '+messages-send', ...args])
    const root = object(envelope, 'lark-cli response')
    if (root.ok !== true) throw new Error('lark-cli response was not successful')
    return object(root.data, 'lark-cli response data')
  }
}

export const name = 'quark-feishu-workflow-effects'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: FeishuWorkflowEffectConfig): void {
  const adapter = new FeishuWorkflowEffectAdapter(config)
  const effects = [ASSISTANT_EFFECTS.notifyOwner, ASSISTANT_EFFECTS.requestInteraction, LARK_EFFECTS.sendAsUser, LARK_EFFECTS.resolveContact]
  const disposers = effects.map(kind => ctx.quarkWorkflows.registerEffect(kind, { execute: effect => adapter.execute(effect) }))
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() }, 'quark Feishu workflow effects')
}

function result(data: Readonly<Record<string, unknown>>) {
  return { messageId: required(data.message_id, 'message_id', 300), chatId: required(data.chat_id, 'chat_id', 300) }
}
function key(value: unknown): string { return `quark-${createHash('sha256').update(required(value, 'idempotencyKey', 2_000)).digest('hex').slice(0, 40)}` }
function required(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); if (value.length > max) throw new Error(`${label} exceeds ${max} characters`); return value }
function optional(value: unknown, label: string, max: number): string | undefined { return value === undefined || value === null || value === '' ? undefined : required(value, label, max) }
function timestamp(value: unknown, label: string): string { const result = required(value, label, 100); if (Number.isNaN(new Date(result).getTime())) throw new Error(`${label} must be a timestamp`); return result }
function object(value: unknown, label: string): Readonly<Record<string, unknown>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Readonly<Record<string, unknown>> }
