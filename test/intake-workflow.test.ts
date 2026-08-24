import assert from 'node:assert/strict'
import test from 'node:test'
import { messageIntakeWorkflow } from '../src/intake/workflow.js'
import { INTAKE_EFFECTS } from '../src/intake/types.js'
import { ASSISTANT_EFFECTS } from '../src/workflow/effects.js'
import { TASK_PROJECTION_EFFECTS } from '../src/task-system/projection-effects.js'
import { CONVERSATION_EFFECTS } from '../src/conversation/types.js'
import { LARK_EFFECTS } from '../src/lark/effects.js'

const message = { kind: 'message.received' as const, source: { channel: 'feishu' as const, messageId: 'om-1', conversationId: 'oc-1', senderId: 'owner' }, eventKey: 'im.message.receive_v1', deduplicationKey: 'om-1', payload: { content: '帮我检查一下', chatType: 'p2p' }, raw: {} }

test('owner DM bypasses enum classification and delegates with loaded conversation context', () => {
  const workflow = messageIntakeWorkflow()
  const initial = workflow.initialize({ route: 'owner-command', event: message, workspace: '/workspace' }, '2026-08-24T00:00:00Z')
  assert.equal(initial.effects?.[0]?.kind, LARK_EFFECTS.loadMessageContext)
  const next = workflow.reduce(initial.state, { id: 'context', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:01Z', payload: { effectId: initial.effects![0]!.id, effectKind: LARK_EFFECTS.loadMessageContext, context: { messages: [{ text: 'previous' }], externalGroup: false } } })
  assert.equal(next.effects?.[0]?.kind, CONVERSATION_EFFECTS.dispatch)
  assert.equal(next.status, 'waiting')
  const reporting = workflow.reduce(next.state, { id: 'result', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:02Z', payload: { effectKind: CONVERSATION_EFFECTS.dispatch, effectId: next.effects![0]!.id, sessionId: 'session-1', summary: '处理完成' } })
  assert.equal(reporting.effects?.[0]?.kind, ASSISTANT_EFFECTS.notifyOwner)
  assert.match(String(reporting.effects?.[0]?.payload.body), /session-1/)
  const completed = workflow.reduce(reporting.state, { id: 'notified', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:03Z', payload: { effectKind: ASSISTANT_EFFECTS.notifyOwner, effectId: reporting.effects![0]!.id } })
  assert.equal(completed.status, 'completed')
})

test('focus intake projects a task but remains pending until the exact approval returns', () => {
  const workflow = messageIntakeWorkflow()
  const initial = workflow.initialize({ route: 'focus', event: message, workspace: '/workspace' }, '2026-08-24T00:00:00Z')
  const evaluating = workflow.reduce(initial.state, { id: 'context', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:01Z', payload: { effectKind: LARK_EFFECTS.loadMessageContext, effectId: initial.effects![0]!.id, context: { messages: [], externalGroup: true } } })
  const projecting = workflow.reduce(evaluating.state, { id: 'decision', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:02Z', payload: { effectKind: INTAKE_EFFECTS.evaluateFocus, effectId: evaluating.effects![0]!.id, decision: { outcome: 'task', summary: '需要批准配额', materialChange: true, notifyOwner: true, approvalRequired: true, title: '确认配额', priority: 3, tags: ['待批准'], researchDecision: 'skip' } } })
  assert.deepEqual(projecting.effects?.map(item => item.kind), [TASK_PROJECTION_EFFECTS.upsertIntake, ASSISTANT_EFFECTS.requestInteraction])
  const approvalId = String(projecting.effects?.[1]?.payload.approvalId)
  assert.match(approvalId, /^intake:.+:approval-decision$/)
  assert.equal(projecting.status, 'waiting')
  const first = workflow.reduce(projecting.state, { id: 'task', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:03Z', payload: { effectKind: TASK_PROJECTION_EFFECTS.upsertIntake, effectId: projecting.effects![0]!.id } })
  assert.equal(first.status, 'waiting')
  const awaiting = workflow.reduce(first.state, { id: 'card', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:04Z', payload: { effectKind: ASSISTANT_EFFECTS.requestInteraction, effectId: projecting.effects![1]!.id } })
  assert.equal(awaiting.status, 'waiting')
  assert.equal(awaiting.state.stage, 'awaiting-approval')
  const withResponse = workflow.reduce(awaiting.state, { id: 'response', type: 'approval.response', occurredAt: '2026-08-24T00:00:05Z', payload: { approvalId, response: '先确认客户当前调用量' } })
  assert.equal(withResponse.status, 'waiting')
  assert.equal(withResponse.state.approvalResponse, '先确认客户当前调用量')
  const done = workflow.reduce(withResponse.state, { id: 'approved', type: 'approval.approved', occurredAt: '2026-08-24T00:00:06Z', payload: { approvalId } })
  assert.equal(done.status, 'completed')
  assert.equal(done.state.approvalDecision, 'approved')
})

test('focus approval rejects a callback for a different approval', () => {
  const workflow = messageIntakeWorkflow()
  const initial = workflow.initialize({ route: 'focus', event: message, workspace: '/workspace' }, '2026-08-24T00:00:00Z')
  const evaluating = workflow.reduce(initial.state, { id: 'context', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:01Z', payload: { effectKind: LARK_EFFECTS.loadMessageContext, effectId: initial.effects![0]!.id, context: {} } })
  const projecting = workflow.reduce(evaluating.state, { id: 'decision', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:02Z', payload: { effectKind: INTAKE_EFFECTS.evaluateFocus, effectId: evaluating.effects![0]!.id, decision: { outcome: 'notify', summary: '需要批准', materialChange: true, notifyOwner: true, approvalRequired: true } } })
  const awaiting = workflow.reduce(projecting.state, { id: 'card', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:03Z', payload: { effectKind: ASSISTANT_EFFECTS.requestInteraction, effectId: projecting.effects![0]!.id } })
  assert.throws(() => workflow.reduce(awaiting.state, { id: 'wrong', type: 'approval.approved', occurredAt: '2026-08-24T00:00:04Z', payload: { approvalId: 'other' } }), /correlation mismatch/)
})

test('unchanged decisions cannot notify and ignored decisions cannot request approval', () => {
  const workflow = messageIntakeWorkflow()
  const initial = workflow.initialize({ route: 'focus', event: message, workspace: '/workspace' }, '2026-08-24T00:00:00Z')
  const evaluating = workflow.reduce(initial.state, { id: 'context', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:01Z', payload: { effectKind: LARK_EFFECTS.loadMessageContext, effectId: initial.effects![0]!.id, context: {} } })
  assert.throws(() => workflow.reduce(evaluating.state, { id: 'decision', type: 'effect.delivered', occurredAt: '2026-08-24T00:00:02Z', payload: { effectKind: INTAKE_EFFECTS.evaluateFocus, effectId: evaluating.effects![0]!.id, decision: { outcome: 'ignored', summary: 'ok', materialChange: false, notifyOwner: true, approvalRequired: false } } }), /unchanged|ignored/)
})

test('card interaction is routed as an exact-correlated durable effect', () => {
  const workflow = messageIntakeWorkflow()
  const card = { ...message, kind: 'card.action' as const, eventKey: 'card.action.trigger', deduplicationKey: 'evt-card', payload: { operatorId: 'owner', actionValue: '{"approvalId":"approval-1"}' } }
  const initial = workflow.initialize({ route: 'interaction', event: card, workspace: '/workspace' }, '2026-08-24T00:00:00Z')
  assert.equal(initial.effects?.[0]?.kind, INTAKE_EFFECTS.applyInteraction)
  assert.equal(initial.effects?.[0]?.payload.requireExactOwnerAndCorrelation, true)
})
