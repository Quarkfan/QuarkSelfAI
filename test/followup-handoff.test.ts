import assert from 'node:assert/strict'
import test from 'node:test'
import { applyFollowupHandoff, prepareFollowupHandoff } from '../src/migration/followup-handoff.js'

test('followup handoff preserves pending approvals and excludes legacy errors', async () => {
  const handoff = prepareFollowupHandoff({ followupLastCheckedDay: '2026-08-21', followupOutreachRequests: [{
    id: 'legacy-request', status: 'pending_approval', taskId: 'task-1', title: '确认进度', personName: '张三', question: '进展如何？', reason: '约定时间已到', context: '项目跟进', attempts: 2, lastError: 'must not migrate', contact: { openId: 'ou_zhang', name: '张三', department: '研发', external: false },
  }] }, {}, '2026-08-24T00:00:00Z')
  assert.deepEqual(handoff.counts, { outreach: 1, awaitingContact: 0, awaitingApproval: 1, waitingReply: 0, completed: 0, failures: 2, reviewCheckpoint: 1 })
  assert.equal(handoff.workflows[1]?.id, 'followup-outreach:legacy-request')
  assert.equal(handoff.workflows[1]?.state.approvalId, 'followup:legacy-request:approval:ou_zhang')
  assert.equal(JSON.stringify(handoff.workflows).includes('must not migrate'), false)
  const ids = new Set<string>(); const target = { async createWorkflow(input: { id: string }) { const inserted = !ids.has(input.id); ids.add(input.id); return { inserted } } }
  assert.deepEqual(await applyFollowupHandoff(target, handoff, handoff.digest), { inserted: 2, existing: 0 })
  assert.deepEqual(await applyFollowupHandoff(target, handoff, handoff.digest), { inserted: 0, existing: 2 })
  await assert.rejects(applyFollowupHandoff(target, handoff, 'bad'), /digest changed/)
})
