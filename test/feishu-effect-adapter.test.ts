import assert from 'node:assert/strict'
import test from 'node:test'
import type { ClaimedWorkflowEffect } from '../src/storage/types.js'
import { FeishuWorkflowEffectAdapter } from '../src/lark/effect-plugin.js'
import { FeishuContextEffectAdapter } from '../src/lark/context-effect-plugin.js'
import type { CliOutput, CommandRunner } from '../src/lark/runner.js'
import { LARK_EFFECTS } from '../src/lark/effects.js'
import { decodeCardCorrelation } from '../src/lark/card-correlation.js'

class RecordingRunner implements CommandRunner {
  readonly calls: Array<{ executable: string; args: readonly string[] }> = []
  response: unknown = { ok: true, identity: 'bot', data: { message_id: 'om_sent', chat_id: 'oc_owner' } }
  handler?: (args: readonly string[]) => unknown
  async run(executable: string, args: readonly string[]): Promise<CliOutput> {
    this.calls.push({ executable, args })
    return { exitCode: 0, stderr: '', stdout: JSON.stringify(this.handler?.(args) ?? this.response) }
  }
}

test('loads bounded direct-message context read-only for the intake workflow', async () => {
  const runner = new RecordingRunner()
  runner.handler = () => ({ ok: true, data: { messages: [
    { message_id: 'om_1', sender_id: 'ou_owner', sender_name: '常东旭', create_time: '2026-08-24T00:00:00Z', content: '先检查配置', message_type: 'text' },
  ] } })
  const adapter = new FeishuContextEffectAdapter({}, runner)
  const output = await adapter.execute(effect(LARK_EFFECTS.loadMessageContext, {
    requestedAt: '2099-08-24T00:00:00Z',
    event: { occurredAt: '2099-08-24T00:00:00Z', source: { containerId: 'oc_owner' }, payload: { chatType: 'p2p' } },
  }))
  assert.deepEqual(output, { context: { externalGroup: false, relationship: 'direct-message', messages: [
    { messageId: 'om_1', senderId: 'ou_owner', senderName: '常东旭', createdAt: '2026-08-24T00:00:00Z', content: '先检查配置', messageType: 'text' },
  ] } })
  assert.deepEqual(runner.calls[0]?.args.slice(0, 2), ['im', '+chat-messages-list'])
  assert.equal(runner.calls[0]?.args.includes('--no-reactions'), true)
})

test('fails closed to unknown when group metadata does not prove external status', async () => {
  const runner = new RecordingRunner()
  runner.handler = args => args.includes('+chat-messages-list')
    ? { ok: true, data: { messages: [] } }
    : { ok: true, data: { name: '群聊但没有外部标识' } }
  const adapter = new FeishuContextEffectAdapter({}, runner)
  const output = await adapter.execute(effect(LARK_EFFECTS.loadMessageContext, {
    requestedAt: '2099-08-24T00:00:00Z',
    event: { occurredAt: '2099-08-24T00:00:00Z', source: { containerId: 'oc_group' }, payload: { chatType: 'group' } },
  }))
  assert.equal((output.context as Record<string, unknown>).externalGroup, 'unknown')
  assert.deepEqual(runner.calls[1]?.args.slice(0, 3), ['im', 'chats', 'get'])
})

function effect(kind: string, payload: Readonly<Record<string, unknown>>): ClaimedWorkflowEffect {
  return { id: `effect:${kind}`, instanceId: 'workflow:1', kind, payload, attempt: 1 }
}

test('sends owner notifications as a structured Card 2.0 with stable idempotency', async () => {
  const runner = new RecordingRunner()
  const adapter = new FeishuWorkflowEffectAdapter({ ownerOpenId: 'ou_owner' }, runner)
  const output = await adapter.execute(effect('assistant.notify-owner.v1', { title: '处理进展', body: '状态已经更新', idempotencyKey: 'notice:1' }))
  assert.deepEqual(output, { messageId: 'om_sent', chatId: 'oc_owner' })
  const args = runner.calls[0]!.args
  assert.deepEqual(args.slice(0, 2), ['im', '+messages-send'])
  assert.equal(args[args.indexOf('--as') + 1], 'bot')
  const card = JSON.parse(args[args.indexOf('--content') + 1]!) as Record<string, unknown>
  assert.equal(card.schema, '2.0')
  assert.equal((card.header as Record<string, unknown>).template, 'blue')
  assert.equal(String(args[args.indexOf('--idempotency-key') + 1]).length, 46)
})

test('builds interaction cards with exact callback correlation and a response form', async () => {
  const runner = new RecordingRunner()
  const adapter = new FeishuWorkflowEffectAdapter({ ownerOpenId: 'ou_owner' }, runner)
  const item = effect('assistant.request-interaction.v1', { mode: 'approval', title: '确认对外跟进', prompt: '是否联系张三？', approvalId: 'approval:42' })
  await adapter.execute(item)
  const args = runner.calls[0]!.args
  const card = JSON.parse(args[args.indexOf('--content') + 1]!) as { body: { elements: Array<Record<string, unknown>> } }
  const actionSet = card.body.elements.find(element => element.tag === 'column_set'
    && Array.isArray(element.columns)
    && (element.columns as Array<{ elements?: Array<{ tag?: string }> }>).some(column => column.elements?.some(button => button.tag === 'button')))
  const buttons = actionSet?.columns as Array<{ elements: Array<{ behaviors?: Array<{ value?: Record<string, unknown> }> }> }>
  const callback = buttons?.[0]?.elements[0]?.behaviors?.[0]?.value
  assert.equal(callback?.decision, 'approved')
  assert.deepEqual(decodeCardCorrelation(callback?.correlation), {
    workflowId: item.instanceId, effectId: item.id, approvalId: 'approval:42',
  })
  assert.equal(card.body.elements.some(element => element.tag === 'form'), true)
  const form = card.body.elements.find(element => element.tag === 'form')
  assert.deepEqual(decodeCardCorrelation(form?.name), {
    workflowId: item.instanceId, effectId: item.id, eventType: 'approval.response', approvalId: 'approval:42', payloadKey: 'response',
  })
})

test('choice cards carry business-declared event payload mapping', async () => {
  const runner = new RecordingRunner()
  const adapter = new FeishuWorkflowEffectAdapter({ ownerOpenId: 'ou_owner' }, runner)
  await adapter.execute(effect('assistant.request-interaction.v1', {
    mode: 'choice', title: '选择联系人', prompt: '请选择', eventType: 'followup.contact-selected', payloadKey: 'openId',
    options: [{ label: '张三', value: 'ou_zhang' }],
  }))
  const args = runner.calls[0]!.args
  const card = JSON.parse(args[args.indexOf('--content') + 1]!) as { body: { elements: Array<Record<string, unknown>> } }
  const select = card.body.elements.find(element => element.tag === 'select_static') as { options: Array<{ value: string }> }
  const callback = JSON.parse(select.options[0]!.value) as { correlation: string; value: string }
  assert.equal(callback.value, 'ou_zhang')
  assert.deepEqual(decodeCardCorrelation(callback.correlation), {
    workflowId: 'workflow:1', effectId: 'effect:assistant.request-interaction.v1', eventType: 'followup.contact-selected', payloadKey: 'openId',
  })
})

test('refuses send-as-user without durable approval evidence', async () => {
  const runner = new RecordingRunner()
  const adapter = new FeishuWorkflowEffectAdapter({ ownerOpenId: 'ou_owner' }, runner)
  await assert.rejects(adapter.execute(effect('feishu.send-as-user.v1', { openId: 'ou_contact', content: 'hello' })), /send approvalId is required/)
  assert.equal(runner.calls.length, 0)
})

test('sends approved external messages as the user and preserves formatted content', async () => {
  const runner = new RecordingRunner()
  const adapter = new FeishuWorkflowEffectAdapter({ ownerOpenId: 'ou_owner', executable: 'lark-cli-next' }, runner)
  const output = await adapter.execute(effect('feishu.send-as-user.v1', {
    openId: 'ou_contact', content: '**我是常东旭的 AI 分身。**\n\n请确认进度。',
    approvalId: 'approval:42', approvedAt: '2026-08-24T09:00:00.000Z', idempotencyKey: 'followup:42',
  }))
  assert.equal(output.messageId, 'om_sent')
  assert.equal(runner.calls[0]!.executable, 'lark-cli-next')
  const args = runner.calls[0]!.args
  assert.equal(args[args.indexOf('--as') + 1], 'user')
  assert.equal(args[args.indexOf('--user-id') + 1], 'ou_contact')
  assert.equal(args[args.indexOf('--markdown') + 1], '**我是常东旭的 AI 分身。**\n\n请确认进度。')
})

test('resolves contact candidates read-only without choosing an ambiguous person', async () => {
  const runner = new RecordingRunner()
  runner.response = { ok: true, identity: 'user', data: { has_more: false, users: [
    { open_id: 'ou_1', localized_name: '张三', department: '研发-平台', enterprise_email: 'one@example.test', is_cross_tenant: false },
    { open_id: 'ou_2', localized_name: '张三', department: '交付', email: 'two@example.test', is_cross_tenant: true },
  ] } }
  const adapter = new FeishuWorkflowEffectAdapter({ ownerOpenId: 'ou_owner' }, runner)
  const output = await adapter.execute(effect('feishu.resolve-contact.v1', { query: '张三' }))
  assert.deepEqual(output, { hasMore: false, candidates: [
    { openId: 'ou_1', name: '张三', department: '研发-平台', email: 'one@example.test', external: false },
    { openId: 'ou_2', name: '张三', department: '交付', email: 'two@example.test', external: true },
  ] })
  const args = runner.calls[0]!.args
  assert.deepEqual(args.slice(0, 2), ['contact', '+search-user'])
  assert.equal(args[args.indexOf('--as') + 1], 'user')
  assert.equal(args.includes('--has-chatted'), true)
})
