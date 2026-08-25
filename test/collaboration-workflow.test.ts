import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ASSISTANT_EFFECTS } from '../src/workflow/effects.js'
import { DurableStateService } from '../src/storage/service.js'
import { DurableWorkflowRuntime } from '../src/workflow/runtime.js'
import { CollaborationLearningService } from '../src/collaboration/plugin.js'
import {
  COLLABORATION_EFFECTS, collaborationPolicyApprovalWorkflow, collaborationScheduleWorkflow,
} from '../src/collaboration/workflow.js'
import type { CollaborationPolicyProposal } from '../src/collaboration/types.js'

const proposal: CollaborationPolicyProposal = {
  id: 'policy-1', revision: 1, sourceText: '普通消息批量汇总',
  document: {
    version: 1, name: '普通消息批量汇总', description: '只作用于群 oc_1', priority: 200,
    when: { fact: 'source.chatId', op: 'eq', value: 'oc_1' }, effect: { attention: 'batch' },
  },
  simulation: {
    sampleCount: 20, matchedCount: 18, silentCount: 0, batchCount: 18, realtimeCount: 0,
    urgentSuppressedCount: 0, coverageSufficient: true, safeToActivate: true, matchedSampleIds: [],
  },
  sampleCount: 20, reducibleCount: 18, confidence: 0.9,
}

test('collaboration evaluation cadence is a durable workflow, not an in-memory poller', () => {
  const workflow = collaborationScheduleWorkflow(86_400_000)
  const initial = workflow.initialize({}, '2026-08-25T00:00:00.000Z')
  assert.equal(initial.wakeAt, '2026-08-25T00:00:00.000Z')
  const evaluating = workflow.reduce(initial.state, {
    id: 'timer', type: 'timer', occurredAt: '2026-08-25T00:00:00.000Z', payload: {},
  })
  assert.equal(evaluating.wakeAt, null)
  assert.equal(evaluating.effects?.[0]?.kind, COLLABORATION_EFFECTS.evaluate)
  const scheduled = workflow.reduce(evaluating.state, {
    id: 'done', type: 'effect.delivered', occurredAt: '2026-08-25T00:00:01.000Z',
    payload: { effectKind: COLLABORATION_EFFECTS.evaluate },
  })
  assert.equal(scheduled.wakeAt, '2026-08-26T00:00:01.000Z')
})

test('collaboration policy proposal requires exact owner approval before activation effect', () => {
  const workflow = collaborationPolicyApprovalWorkflow()
  const initial = workflow.initialize({ proposal }, '2026-08-25T00:00:00.000Z')
  assert.equal(initial.effects?.[0]?.kind, ASSISTANT_EFFECTS.requestInteraction)
  assert.match(String(initial.effects?.[0]?.payload.prompt), /20 条样本/)
  const approvalId = String(initial.state.approvalId)
  assert.throws(() => workflow.reduce(initial.state, {
    id: 'wrong', type: 'approval.approved', occurredAt: '2026-08-25T00:00:01.000Z', payload: { approvalId: 'wrong' },
  }), /correlation mismatch/)
  const noted = workflow.reduce(initial.state, {
    id: 'note', type: 'approval.response', occurredAt: '2026-08-25T00:00:01.000Z', payload: { approvalId, response: '先观察这个群' },
  })
  assert.equal(noted.state.response, '先观察这个群')
  const applying = workflow.reduce(noted.state, {
    id: 'approve', type: 'approval.approved', occurredAt: '2026-08-25T00:00:02.000Z', payload: { approvalId },
  })
  assert.equal(applying.effects?.[0]?.kind, COLLABORATION_EFFECTS.applyDecision)
  assert.deepEqual(applying.effects?.[0]?.payload, {
    policyId: 'policy-1', revision: 1, decision: 'approve', decidedAt: '2026-08-25T00:00:02.000Z', response: '先观察这个群',
  })
  const completed = workflow.reduce(applying.state, {
    id: 'applied', type: 'effect.delivered', occurredAt: '2026-08-25T00:00:03.000Z',
    payload: { effectKind: COLLABORATION_EFFECTS.applyDecision },
  })
  assert.equal(completed.status, 'completed')
})

test('declining a collaboration proposal records the decision without activating it', () => {
  const workflow = collaborationPolicyApprovalWorkflow()
  const initial = workflow.initialize({ proposal }, '2026-08-25T00:00:00.000Z')
  const declined = workflow.reduce(initial.state, {
    id: 'decline', type: 'approval.declined', occurredAt: '2026-08-25T00:00:01.000Z', payload: { approvalId: initial.state.approvalId },
  })
  assert.equal(declined.effects?.[0]?.payload.decision, 'decline')
})

test('approved collaboration card activates the exact safe policy revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-collaboration-approval-'))
  const ctx = new Context()
  try {
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'assistant.sqlite3') })
    await ctx.plugin(DurableWorkflowRuntime, { workerId: 'collaboration-test', enabled: false })
    ctx.quarkWorkflows.registerEffect(ASSISTANT_EFFECTS.requestInteraction, { async execute() { return { messageId: 'om-card' } } })
    await ctx.plugin(CollaborationLearningService, { enabled: false })
    await ctx.quarkPolicyState.savePolicyDraft({
      id: proposal.id, name: proposal.document.name, sourceText: proposal.sourceText,
      document: proposal.document, simulation: proposal.simulation,
    })
    const workflowId = `collaboration-policy:${proposal.id}`
    await ctx.quarkWorkflows.start(workflowId, 'assistant.collaboration-learning.policy-approval.v1', { proposal }, new Date('2026-08-25T00:00:00.000Z'))
    const cardRun = await ctx.quarkWorkflows.runOnce(new Date('2026-08-25T00:00:01.000Z'))
    assert.equal(cardRun.effect, 'delivered')
    const approvalId = String((await ctx.quarkWorkflows.workflow(workflowId))?.state.approvalId)
    await ctx.quarkWorkflows.dispatch(workflowId, {
      id: 'owner-approved', type: 'approval.approved', occurredAt: '2026-08-25T00:00:02.000Z', payload: { approvalId },
    })
    const decisionRun = await ctx.quarkWorkflows.runOnce(new Date('2026-08-25T00:00:03.000Z'))
    assert.equal(decisionRun.effect, 'delivered')
    assert.equal((await ctx.quarkWorkflows.workflow(workflowId))?.status, 'completed')
    const decisions = await ctx.quarkSignalState.recentSignals('collaboration.owner-signal.v1', 10)
    assert.equal(decisions[0]?.data.decision, 'approve')
    assert.equal(decisions[0]?.data.policyId, proposal.id)
  } finally {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
