import assert from 'node:assert/strict'
import test from 'node:test'
import type { ClaimedWorkflowEffect } from '../src/storage/types.js'
import { FeishuWorkflowEffectAdapter } from '../src/lark/effect-plugin.js'
import type { CliOutput, CommandRunner } from '../src/lark/runner.js'

class RecordingRunner implements CommandRunner {
  readonly calls: Array<{ executable: string; args: readonly string[] }> = []
  response: unknown = { ok: true, identity: 'bot', data: { message_id: 'om_sent', chat_id: 'oc_owner' } }
  async run(executable: string, args: readonly string[]): Promise<CliOutput> {
    this.calls.push({ executable, args })
    return { exitCode: 0, stderr: '', stdout: JSON.stringify(this.response) }
  }
}

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
  assert.deepEqual(callback, { effectId: item.id, approvalId: 'approval:42', decision: 'approved' })
  assert.equal(card.body.elements.some(element => element.tag === 'form'), true)
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
