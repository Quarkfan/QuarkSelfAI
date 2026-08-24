import assert from 'node:assert/strict'
import test from 'node:test'
import { FOLLOWUP_EFFECTS } from '../src/followup/types.js'
import { followupReviewWorkflow } from '../src/followup/review-workflow.js'
import { followupOutreachWorkflow } from '../src/followup/outreach-workflow.js'
import { LARK_EFFECTS } from '../src/lark/effects.js'
import { TASK_EFFECTS } from '../src/task-system/effects.js'
import { ASSISTANT_EFFECTS } from '../src/workflow/effects.js'

const event = (id: string, type: string, occurredAt: string, payload: Record<string, unknown> = {}) => ({ id, type, occurredAt, payload })

test('workday review distributes updates, reminders, and outreach once per local workday', () => {
  const definition = followupReviewWorkflow({ timeZone: 'Asia/Shanghai', scheduledHour: 10, pollIntervalMs: 60_000 })
  const initialized = definition.initialize({}, '2026-08-24T01:59:00Z')
  const early = definition.reduce(initialized.state, event('early', 'timer', '2026-08-24T01:59:00Z'))
  assert.equal(early.effects?.length ?? 0, 0)
  const evaluating = definition.reduce(early.state, event('due', 'timer', '2026-08-24T02:00:00Z'))
  assert.equal(evaluating.effects?.[0]?.kind, TASK_EFFECTS.evaluateFollowups)
  const distributing = definition.reduce(evaluating.state, event('evaluated', 'effect.delivered', '2026-08-24T02:00:01Z', {
    effectKind: TASK_EFFECTS.evaluateFollowups, updates: [], reminders: [{ taskId: 'task-1', title: '确认进度', urgency: 'medium', reason: '约定时间已到', recommendedAction: '联系负责人' }],
    outreachRequests: [{ taskId: 'task-1', title: '确认进度', personName: '张三', question: '进展如何？', reason: '约定时间已到', context: '项目跟进' }],
  }))
  assert.deepEqual(new Set(distributing.effects?.map(item => item.kind)), new Set([ASSISTANT_EFFECTS.notifyOwner, FOLLOWUP_EFFECTS.openOutreach]))
  let current = distributing
  for (const effect of distributing.effects ?? []) current = definition.reduce(current.state, event(`done:${effect.id}`, 'effect.delivered', '2026-08-24T02:00:02Z', { effectKind: effect.kind, effectId: effect.id }))
  assert.equal(current.state.lastCompletedDay, '2026-08-24')
  const sameDay = definition.reduce(current.state, event('same-day', 'timer', '2026-08-24T03:00:00Z'))
  assert.equal(sameDay.effects?.length ?? 0, 0)
})

test('workday evaluation failure can create a fresh durable retry effect', () => {
  const definition = followupReviewWorkflow({ pollIntervalMs: 60_000 })
  const first = definition.reduce(definition.initialize({}, '2026-08-24T02:00:00Z').state, event('timer-1', 'timer', '2026-08-24T02:00:00Z'))
  const failed = definition.reduce(first.state, event('failed', 'effect.failed', '2026-08-24T02:00:01Z', { effectKind: TASK_EFFECTS.evaluateFollowups, effectId: first.effects?.[0]?.id }))
  const retry = definition.reduce(failed.state, event('timer-2', 'timer', failed.wakeAt as string))
  assert.notEqual(retry.effects?.[0]?.id, first.effects?.[0]?.id)
})

test('outreach requires exact approval before sending and persists reply synchronization', () => {
  const definition = followupOutreachWorkflow()
  const initial = definition.initialize({ taskId: 'task-1', title: '确认进度', personName: '张三', question: '当前进展如何？', reason: '约定时间已到', context: '项目跟进' }, '2026-08-24T00:00:00Z')
  const resolving = definition.reduce(initial.state, event('resolve-timer', 'timer', '2026-08-24T00:00:01Z'))
  const approval = definition.reduce(resolving.state, event('resolved', 'effect.delivered', '2026-08-24T00:00:02Z', {
    effectKind: LARK_EFFECTS.resolveContact, candidates: [{ openId: 'ou_zhang', name: '张三', department: '研发', external: false }],
  }))
  assert.equal(approval.effects?.[0]?.kind, ASSISTANT_EFFECTS.requestInteraction)
  assert.equal(approval.effects?.some(item => item.kind === LARK_EFFECTS.sendAsUser), false)
  assert.throws(() => definition.reduce(approval.state, event('bad-approval', 'approval.approved', '2026-08-24T00:00:03Z', { approvalId: 'wrong' })), /mismatch/)
  const sending = definition.reduce(approval.state, event('approved', 'approval.approved', '2026-08-24T00:00:03Z', { approvalId: approval.state.approvalId }))
  assert.equal(sending.effects?.[0]?.kind, LARK_EFFECTS.sendAsUser)
  assert.match(String(sending.effects?.[0]?.payload.content), /我是常东旭的 AI 分身/)
  assert.equal(sending.effects?.[0]?.payload.approvalId, approval.state.approvalId)
  assert.equal(sending.effects?.[0]?.payload.approvedAt, '2026-08-24T00:00:03Z')
  const waiting = definition.reduce(sending.state, event('sent', 'effect.delivered', '2026-08-24T00:00:04Z', { effectKind: LARK_EFFECTS.sendAsUser, messageId: 'om_sent', chatId: 'oc_chat' }))
  const updating = definition.reduce(waiting.state, event('reply', 'followup.reply', '2026-08-24T02:00:00Z', { messageId: 'om_reply', content: '今天已完成' }))
  assert.equal(updating.effects?.[0]?.kind, TASK_EFFECTS.recordFollowupReply)
  const notifying = definition.reduce(updating.state, event('updated', 'effect.delivered', '2026-08-24T02:00:01Z', { effectKind: TASK_EFFECTS.recordFollowupReply, result: { title: '确认进度', changes: ['追加回复'], summary: '已完成' } }))
  assert.equal(notifying.effects?.[0]?.kind, ASSISTANT_EFFECTS.notifyOwner)
  const completed = definition.reduce(notifying.state, event('notified', 'effect.delivered', '2026-08-24T02:00:02Z', { effectKind: ASSISTANT_EFFECTS.notifyOwner, effectId: notifying.effects?.[0]?.id }))
  assert.equal(completed.status, 'completed')
  assert.equal(completed.state.outcome, 'completed')
})

test('ambiguous contacts require a choice and an interaction failure is retryable', () => {
  const definition = followupOutreachWorkflow({ retryBaseMs: 1_000, retryMaxMs: 2_000 })
  const input = { taskId: 'task-1', title: '确认进度', personName: '张三', question: '进展？', reason: '到期', context: '项目' }
  const resolving = definition.reduce(definition.initialize(input, '2026-08-24T00:00:00Z').state, event('timer', 'timer', '2026-08-24T00:00:01Z'))
  const choosing = definition.reduce(resolving.state, event('resolved', 'effect.delivered', '2026-08-24T00:00:02Z', { effectKind: LARK_EFFECTS.resolveContact, candidates: [{ openId: 'ou_1', name: '张三', external: false }, { openId: 'ou_2', name: '张三', external: false }] }))
  assert.equal(choosing.state.phase, 'awaiting-contact')
  const failed = definition.reduce(choosing.state, event('card-failed', 'effect.failed', '2026-08-24T00:00:03Z', { effectKind: ASSISTANT_EFFECTS.requestInteraction, effectId: choosing.effects?.[0]?.id }))
  assert.ok(failed.wakeAt)
  const retried = definition.reduce(failed.state, event('retry', 'timer', failed.wakeAt as string))
  assert.notEqual(retried.effects?.[0]?.id, choosing.effects?.[0]?.id)
})
