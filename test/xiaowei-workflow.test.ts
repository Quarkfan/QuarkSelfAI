import assert from 'node:assert/strict'
import test from 'node:test'
import { LARK_EFFECTS } from '../src/lark/effects.js'
import { TASK_EFFECTS } from '../src/task-system/effects.js'
import { ASSISTANT_EFFECTS } from '../src/workflow/effects.js'
import { xiaoweiResearchWorkflow } from '../src/xiaowei/workflow.js'

const definition = () => xiaoweiResearchWorkflow({ agentOpenId: 'ou_agent', agentChatId: 'oc_agent', failureNotifyThreshold: 1 })
const input = { requestId: 'req-1', approvedAt: '2026-08-24T00:00:00Z', taskId: 'task-1', title: '排查生产超时', prompt: '核对日志和 Trace' }
const event = (id: string, type: string, at: string, payload: Record<string, unknown> = {}) => ({ id, type, occurredAt: at, payload })

test('Xiaowei workflow requires prior approval and synchronizes a slow reply sequentially', () => {
  assert.throws(() => definition().initialize({ ...input, approvedAt: '' }, '2026-08-24T00:00:00Z'), /approvedAt/)
  const ready = definition().initialize(input, '2026-08-24T00:00:01Z')
  const sending = definition().reduce(ready.state, event('timer', 'timer', '2026-08-24T00:00:02Z'))
  assert.equal(sending.wakeAt, null)
  assert.equal(sending.effects?.[0]?.kind, LARK_EFFECTS.sendAsUser)
  assert.match(String(sending.effects?.[0]?.payload.content), /只读排查/)
  const waiting = definition().reduce(sending.state, event('sent', 'effect.delivered', '2026-08-24T00:00:03Z', {
    effectKind: LARK_EFFECTS.sendAsUser, messageId: 'om_request',
  }))
  assert.equal(waiting.state.phase, 'waiting-reply')
  const syncing = definition().reduce(waiting.state, event('reply', 'xiaowei.reply', '2026-08-24T02:00:00Z', {
    messageId: 'om_reply', content: '已定位首个后端抛错点', url: 'https://example.test/reply',
  }))
  assert.deepEqual(syncing.effects?.map(effect => effect.kind), [ASSISTANT_EFFECTS.notifyOwner])
  const notified = definition().reduce(syncing.state, event('notified', 'effect.delivered', '2026-08-24T02:00:01Z', {
    effectKind: ASSISTANT_EFFECTS.notifyOwner, effectId: syncing.effects?.[0]?.id,
  }))
  assert.deepEqual(notified.effects?.map(effect => effect.kind), [TASK_EFFECTS.recordResearchResult])
  const completed = definition().reduce(notified.state, event('task-updated', 'effect.delivered', '2026-08-24T02:00:02Z', {
    effectKind: TASK_EFFECTS.recordResearchResult, effectId: notified.effects?.[0]?.id,
  }))
  assert.equal(completed.status, 'completed')
})

test('Xiaowei workflow retries with stable external idempotency and bounded failure state', () => {
  const ready = definition().initialize(input, '2026-08-24T00:00:01Z')
  const sending = definition().reduce(ready.state, event('timer', 'timer', '2026-08-24T00:00:02Z'))
  const key = sending.effects?.[0]?.payload.idempotencyKey
  const failed = definition().reduce(sending.state, event('failed', 'effect.failed', '2026-08-24T00:10:00Z', {
    effectKind: LARK_EFFECTS.sendAsUser, effectId: sending.effects?.[0]?.id, error: 'secret transport failure',
  }))
  assert.equal(JSON.stringify(failed.state).includes('secret transport failure'), false)
  assert.equal(failed.effects?.[0]?.kind, ASSISTANT_EFFECTS.notifyOwner)
  const noticeSettled = definition().reduce(failed.state, event('notice', 'effect.delivered', '2026-08-24T00:10:01Z', {
    effectKind: ASSISTANT_EFFECTS.notifyOwner, effectId: failed.effects?.[0]?.id,
  }))
  assert.equal(noticeSettled.wakeAt, undefined)
  const retrying = definition().reduce(noticeSettled.state, event('retry', 'timer', failed.wakeAt as string))
  assert.equal(retrying.effects?.[0]?.payload.idempotencyKey, key)
  assert.notEqual(retrying.effects?.[0]?.id, sending.effects?.[0]?.id)
})
