import assert from 'node:assert/strict'
import test from 'node:test'
import { InteractionEffectAdapter } from '../src/intake/interaction-effect-plugin.js'
import { INTAKE_EFFECTS } from '../src/intake/types.js'
import { encodeCardCorrelation } from '../src/lark/card-correlation.js'
import type { ClaimedWorkflowEffect, WorkflowInstance } from '../src/storage/types.js'
import type { WorkflowEvent } from '../src/workflow/runtime.js'

class RecordingWorkflows {
  readonly calls: Array<{ instanceId: string; event: WorkflowEvent }> = []
  async dispatch(instanceId: string, event: WorkflowEvent): Promise<WorkflowInstance> {
    this.calls.push({ instanceId, event })
    return { id: instanceId, kind: 'test', definitionVersion: 1, status: 'waiting', state: {}, revision: 1, createdAt: event.occurredAt, updatedAt: event.occurredAt }
  }
}

test('routes an owner approval to the exact workflow with durable correlation', async () => {
  const workflows = new RecordingWorkflows()
  const adapter = new InteractionEffectAdapter({ ownerOpenId: 'ou_owner' }, workflows)
  const correlation = encodeCardCorrelation({ workflowId: 'followup-outreach:req-1', effectId: 'approval-effect', approvalId: 'approval:1' })
  const output = await adapter.execute(interaction({ operatorId: 'ou_owner', actionValue: { correlation, decision: 'approved' } }))
  assert.deepEqual(output, { workflowId: 'followup-outreach:req-1', eventType: 'approval.approved', accepted: true })
  assert.equal(workflows.calls.length, 1)
  assert.equal(workflows.calls[0]?.instanceId, 'followup-outreach:req-1')
  assert.equal(workflows.calls[0]?.event.type, 'approval.approved')
  assert.deepEqual(workflows.calls[0]?.event.payload, { approvalId: 'approval:1' })
  assert.match(workflows.calls[0]!.event.id, /^card-action:[a-f0-9]{32}$/)
})

test('routes choice and input values using the business-declared payload key', async () => {
  const workflows = new RecordingWorkflows()
  const adapter = new InteractionEffectAdapter({ ownerOpenId: 'ou_owner' }, workflows)
  const choice = encodeCardCorrelation({ workflowId: 'followup-outreach:req-2', effectId: 'choice-effect', eventType: 'followup.contact-selected', payloadKey: 'openId' })
  await adapter.execute(interaction({ operatorId: 'ou_owner', actionValue: JSON.stringify({ correlation: choice, value: 'ou_contact' }) }, 'event-choice'))
  const input = encodeCardCorrelation({ workflowId: 'followup-outreach:req-2', effectId: 'input-effect', eventType: 'followup.contact-query', payloadKey: 'query' })
  await adapter.execute(interaction({ operatorId: 'ou_owner', actionName: input, formValue: { response: '张三 zhang@example.test' } }, 'event-input'))
  assert.deepEqual(workflows.calls.map(call => ({ type: call.event.type, payload: call.event.payload })), [
    { type: 'followup.contact-selected', payload: { openId: 'ou_contact' } },
    { type: 'followup.contact-query', payload: { response: '张三 zhang@example.test', query: '张三 zhang@example.test' } },
  ])
})

test('fails closed for a wrong owner, missing correlation, or undeclared payload mapping', async () => {
  const workflows = new RecordingWorkflows()
  const adapter = new InteractionEffectAdapter({ ownerOpenId: 'ou_owner' }, workflows)
  const valid = encodeCardCorrelation({ workflowId: 'workflow:1', effectId: 'effect:1', approvalId: 'approval:1' })
  await assert.rejects(adapter.execute(interaction({ operatorId: 'ou_other', actionValue: { correlation: valid, decision: 'approved' } })), /configured owner/)
  await assert.rejects(adapter.execute(interaction({ operatorId: 'ou_owner', actionValue: { decision: 'approved' } })), /correlation/)
  const unmapped = encodeCardCorrelation({ workflowId: 'workflow:1', effectId: 'effect:1', eventType: 'test.selected' })
  await assert.rejects(adapter.execute(interaction({ operatorId: 'ou_owner', actionValue: { correlation: unmapped, value: 'x' } })), /payloadKey/)
  assert.equal(workflows.calls.length, 0)
})

function interaction(payload: Readonly<Record<string, unknown>>, deduplicationKey = 'card-event-1'): ClaimedWorkflowEffect {
  return {
    id: `effect:${deduplicationKey}`, instanceId: `message-intake:${deduplicationKey}`, kind: INTAKE_EFFECTS.applyInteraction, attempt: 1,
    payload: { requireExactOwnerAndCorrelation: true, event: { kind: 'card.action', deduplicationKey, occurredAt: '2026-08-24T09:00:00.000Z', payload } },
  }
}
