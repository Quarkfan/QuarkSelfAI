import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkJournalConfig } from '../src/work-journal/config.js'
import { FeishuWorkEvidenceProvider, type FeishuSearchResult } from '../src/work-journal/feishu-evidence.js'

const config: WorkJournalConfig = {
  enabled: true, timeZone: 'Asia/Shanghai', closeHour: 5, pollIntervalMs: 3_600_000,
  modelTimeoutMs: 60_000, workspace: '/tmp', claudeCli: 'claude', codexCli: 'codex',
  larkCli: 'lark-cli', ownerOpenId: 'ou_owner',
}

function result(messages: readonly Readonly<Record<string, unknown>>[], complete = true): FeishuSearchResult {
  return { messages, total: messages.length, complete }
}

const owner = { message_id: 'om_owner', chat_id: 'oc_a', create_time: '2026-09-02T09:00:00+08:00', chat_type: 'group', chat_partner: '项目群', msg_type: 'text', content: '我来跟进', sender: { id: 'ou_owner', name: '常东旭' } }
const mention = { message_id: 'om_mention', chat_id: 'oc_b', create_time: '2026-09-02T10:00:00+08:00', chat_type: 'p2p', chat_partner: '同事', msg_type: 'text', content: '@常东旭 请确认', sender: { id: 'ou_peer', name: '同事' } }

test('collects exhaustive owner, mention, and related-chat context coverage', async () => {
  const calls: readonly string[][] = []
  const mutableCalls = calls as string[][]
  const provider = new FeishuWorkEvidenceProvider({ async load(day) { return { day, base: true } } }, config, async args => {
    mutableCalls.push([...args])
    if (args.includes('--sender')) return result([owner])
    if (args.includes('--is-at-me')) return result([mention])
    assert.equal(args[args.indexOf('--chat-id') + 1], 'oc_a,oc_b')
    return result([
      { ...owner, content: '完整语境中的本人承接' },
      { ...mention, content: '完整语境中的明确请求' },
    ])
  })
  const evidence = await provider.load('2026-09-02')
  const feishu = evidence.feishuDaily as Record<string, unknown>
  const coverage = feishu.coverage as Record<string, unknown>
  assert.equal(evidence.base, true)
  assert.equal(feishu.status, 'available')
  assert.equal(coverage.relatedChats, 2)
  assert.equal(coverage.selectedMessages, 2)
  assert.equal(calls.length, 3)
  assert.ok(calls.every(args => args.includes('--page-all') && args.includes('--as') && args.includes('user')))
  assert.match(JSON.stringify(feishu.messages), /完整语境/)
})

test('marks Feishu partial when any pagination layer is incomplete', async () => {
  const provider = new FeishuWorkEvidenceProvider({ async load(day) { return { day } } }, config, async args => {
    if (args.includes('--sender')) return result([owner], false)
    if (args.includes('--is-at-me')) return result([], true)
    return result([owner], true)
  })
  const evidence = await provider.load('2026-09-02')
  const feishu = evidence.feishuDaily as Record<string, unknown>
  const coverage = feishu.coverage as Record<string, Record<string, unknown>>
  assert.equal(feishu.status, 'partial')
  assert.equal(coverage.ownerSent?.complete, false)
})

test('does not invoke Feishu when owner identity is not configured', async () => {
  let called = false
  const provider = new FeishuWorkEvidenceProvider({ async load(day) { return { day } } }, { ...config, ownerOpenId: undefined }, async () => {
    called = true
    return result([])
  })
  const evidence = await provider.load('2026-09-02')
  assert.equal((evidence.feishuDaily as Record<string, unknown>).status, 'not-configured')
  assert.equal(called, false)
})
