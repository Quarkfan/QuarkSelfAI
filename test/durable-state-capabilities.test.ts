import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { DurableStateService } from '../src/storage/service.js'

test('durable state host exposes narrow frozen capabilities instead of one aggregate service', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-state-capabilities-'))
  const ctx = new Context()
  try {
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'state.sqlite3') })
    assert.equal(ctx.get('quarkState'), undefined)
    assert.equal(ctx.get('quarkStateHost'), undefined)
    assert.deepEqual(Object.keys(ctx.quarkEventAppendState), ['appendEvent'])
    assert.deepEqual(Object.keys(ctx.quarkEventConsumerState).sort(), [
      'claimNextEvent', 'releaseEvent', 'settleEvent', 'updateCheckpoint',
    ])
    assert.deepEqual(Object.keys(ctx.quarkActionEnqueueState), ['enqueueAction'])
    assert.deepEqual(Object.keys(ctx.quarkActionDecisionState), ['decideApproval'])
    assert.deepEqual(Object.keys(ctx.quarkActionWorkerState).sort(), [
      'claimNextAction', 'releaseActionClaim', 'settleAction',
    ])
    for (const name of [
      'quarkEventAppendState', 'quarkEventConsumerState', 'quarkEventQueryState', 'quarkWorkflowState',
      'quarkActionEnqueueState', 'quarkActionDecisionState', 'quarkActionWorkerState', 'quarkSignalState',
      'quarkCheckpointState', 'quarkPolicyState',
    ]) assert.ok(Object.isFrozen(ctx.get(name)), name)
  } finally {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
