import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedChannelEvent } from '../src/domain/contracts.js'
import { INTAKE_EFFECTS } from '../src/intake/types.js'
import { FeishuFocusDiscoveryEffectAdapter } from '../src/lark/discovery-effect-plugin.js'
import type { CliOutput, CommandRunner } from '../src/lark/runner.js'
import type { ClaimedWorkflowEffect } from '../src/storage/types.js'

class Runner implements CommandRunner {
  readonly calls: string[][] = []
  async run(_executable: string, args: readonly string[]): Promise<CliOutput> {
    this.calls.push([...args])
    if (args.includes('+flag-list')) return json({ flag_items: [{ item_id: 'om_flag' }], messages: [{ message_id: 'om_flag', chat_id: 'oc_flag', sender: { id: 'ou_other' }, chat_type: 'group', content: '标记事项' }], has_more: false })
    if (args.includes('+feed-group-list-item')) return json({ items: [{ feed_id: 'oc_star', feed_type: 'chat', chat_name: '专项群' }], has_more: false })
    if (args.includes('+feed-group-list')) return json({ groups: [{ group_id: 'ofg_1', name: '特别关注' }], deleted_groups: [], has_more: false })
    if (args.includes('+messages-search') && args.includes('--sender')) return json({ messages: [{ message_id: 'om_sender', chat_id: 'oc_any', sender: { id: 'ou_focus' }, chat_type: 'group', create_time: '2026-08-24T00:05:00Z', content: '重点联系人更新' }], has_more: false })
    if (args.includes('+messages-search') && args.includes('--chat-id')) return json({ messages: [
      { message_id: 'om_star', chat_id: 'oc_star', sender: { id: 'ou_other' }, chat_type: 'group', create_time: '2026-08-24T00:06:00Z', content: '关注群更新' },
      { message_id: 'om_flag', chat_id: 'oc_flag', sender: { id: 'ou_other' }, chat_type: 'group', content: '标记事项' },
    ], has_more: false })
    if (args.includes('+messages-search') && (args.includes('--chat-type') || args.includes('--is-at-me'))) return json({ messages: [], has_more: false })
    throw new Error(`unexpected command ${args.join(' ')}`)
  }
}

test('discovers configured people, flags and Feishu focus groups into one idempotent inbox', async () => {
  const events: NormalizedChannelEvent[] = []
  const seen = new Set<string>()
  const state = { async appendEvent(event: NormalizedChannelEvent) { events.push(event); const inserted = !seen.has(event.deduplicationKey); seen.add(event.deduplicationKey); return { inserted } } }
  const runner = new Runner()
  const adapter = new FeishuFocusDiscoveryEffectAdapter({}, state, runner)
  const output = await adapter.execute(effect())
  assert.equal(output.candidateCount, 3)
  assert.equal(output.insertedCount, 3)
  assert.deepEqual(events.map(event => event.source.messageId).sort(), ['om_flag', 'om_sender', 'om_star'])
  const flagged = events.find(event => event.source.messageId === 'om_flag')!
  assert.deepEqual(flagged.payload.discoveryReasons, ['flagged-conversation', 'flagged-message'])
  assert.equal(flagged.payload.text, '标记事项')
  assert.equal(events.every(event => event.eventKey === 'quark.focus.discovered.v1'), true)
  const readCommands = new Set(['+flag-list', '+feed-group-list', '+feed-group-list-item', '+messages-search'])
  assert.equal(runner.calls.every(args => readCommands.has(args[1]!)), true)
  assert.equal(runner.calls.filter(args => args.includes('+messages-search')).length, 4)

  const duplicate = await adapter.execute(effect())
  assert.equal(duplicate.insertedCount, 0)
  assert.equal(duplicate.duplicateCount, 3)
})

test('fails closed when a bounded Feishu page is incomplete', async () => {
  const runner: CommandRunner = { async run() { return json({ flag_items: [], has_more: true }) } }
  const adapter = new FeishuFocusDiscoveryEffectAdapter({}, { async appendEvent() { throw new Error('must not append'); } }, runner)
  await assert.rejects(adapter.execute(effect()), /pagination is incomplete/)
})

function effect(): ClaimedWorkflowEffect {
  return {
    id: 'effect:discover', instanceId: 'focus-discovery:singleton', kind: INTAKE_EFFECTS.discoverSignals, attempt: 1,
    payload: {
      from: '2026-08-24T00:00:00Z', until: '2026-08-24T00:10:00Z',
      sources: { ownerOpenId: 'ou_owner', senderIds: ['ou_focus'], conversationIds: [], includeOwnerParticipation: true, includeFlaggedConversations: true, includeDirectMessages: true, includeMentionBackfill: true, feedGroupNames: ['特别关注'] },
    },
  }
}
function json(data: Readonly<Record<string, unknown>>): CliOutput { return { exitCode: 0, stderr: '', stdout: JSON.stringify({ ok: true, identity: 'user', data }) } }
