import assert from 'node:assert/strict'
import test from 'node:test'
import { applyXiaoweiResearchHandoff, prepareXiaoweiResearchHandoff } from '../src/migration/xiaowei-research-handoff.js'

test('prepares idempotent Xiaowei workflows without carrying legacy errors', async () => {
  const handoff = prepareXiaoweiResearchHandoff({ xiaoweiResearchRequests: [{
    id: 'request-1', taskId: 'task-1', title: '排查', prompt: '查日志', status: 'task_update_failed',
    createdAt: '2026-08-20T00:00:00Z', sentMessageId: 'om_request', sentAt: '2026-08-20T00:01:00Z',
    replyMessageId: 'om_reply', replyContent: '结论', replyReceivedAt: '2026-08-20T02:00:00Z', taskUpdateAttempts: 2,
    nextTaskUpdateAt: '2026-08-24T01:00:00Z', lastError: 'must not migrate',
  }] }, { agentOpenId: 'ou_agent', agentChatId: 'oc_agent' }, '2026-08-24T00:00:00Z')
  assert.deepEqual(handoff.counts, { tracked: 1, waitingReply: 0, syncing: 1, completed: 0, failures: 2 })
  assert.equal(handoff.workflows[0]?.state.ownerNotified, true)
  assert.equal(JSON.stringify(handoff.workflows).includes('must not migrate'), false)
  const ids = new Set<string>(); const target = { async createWorkflow(input: { id: string }) { const inserted = !ids.has(input.id); ids.add(input.id); return { inserted } } }
  assert.deepEqual(await applyXiaoweiResearchHandoff(target, handoff, handoff.digest), { inserted: 1, existing: 0 })
  assert.deepEqual(await applyXiaoweiResearchHandoff(target, handoff, handoff.digest), { inserted: 0, existing: 1 })
  await assert.rejects(applyXiaoweiResearchHandoff(target, handoff, 'bad'), /digest changed/)
})
