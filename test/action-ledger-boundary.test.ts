import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ActionLedgerService } from '../src/execution/ledger-service.js'

test('durable action ledger loads and persists without an executor or DSH agent', async () => {
  const enqueued: unknown[] = []
  const ctx = new Context()
  ctx.reflect.provide('quarkActionEnqueueState', {
    async enqueueAction(input: unknown) { enqueued.push(input); return { inserted: true } },
  })
  const fiber = ctx.plugin(ActionLedgerService, {})
  try {
    await fiber
    const action = {
      actionId: 'action-1', matterId: 'matter-1', matterTitle: '事项', matterSummary: '摘要',
      intent: 'inspect', source: { channel: 'feishu' as const },
      request: { title: '检查', prompt: '只读检查', workspace: '/workspace', mode: 'read-only' as const },
    }
    const ledger = ctx.quarkActionLedger
    assert.deepEqual(await new Promise((resolve, reject) => setImmediate(() => ledger.enqueue(action).then(resolve, reject))), { inserted: true })
    assert.deepEqual(enqueued, [action])
    assert.equal('decideApproval' in ctx.quarkActionLedger, false)
    assert.equal('runOnce' in ctx.quarkActionLedger, false)
  } finally {
    await ctx.fiber.dispose()
  }
})
