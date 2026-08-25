import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ActionWorkerService } from '../src/execution/worker-plugin.js'
import type { ExecutorRouterService } from '../src/execution/router.js'
import type { DurableActionWorkerStatePort } from '../src/storage/service-contract.js'
import { DurableStateService } from '../src/storage/service.js'

const action = (id: string, workspace: string, approval?: { readonly id: string; readonly prompt: string }) => ({
  actionId: id,
  matterId: `matter-${id}`,
  matterTitle: id,
  matterSummary: id,
  intent: 'read',
  source: { channel: 'feishu' as const, resourceId: `message-${id}` },
  request: { title: id, prompt: id, workspace, mode: approval ? 'write-with-approval' as const : 'read-only' as const },
  ...(approval ? { approval } : {}),
})

async function flushEvents(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

test('durable action commits emit only actionable wake hints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-action-wake-'))
  const ctx = new Context()
  const hints: Array<string | undefined> = []
  try {
    ctx.on('quark/action-wake', at => { hints.push(at) })
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'assistant.sqlite3') })

    await ctx.quarkActionEnqueueState.enqueueAction(action('immediate', directory))
    await flushEvents()
    assert.deepEqual(hints, [undefined])

    await ctx.quarkActionEnqueueState.enqueueAction(action('approval', directory, { id: 'approval-1', prompt: 'approve' }))
    await flushEvents()
    assert.deepEqual(hints, [undefined])

    await ctx.quarkActionDecisionState.decideApproval('approval-1', 'approved', {}, new Date().toISOString())
    await flushEvents()
    assert.deepEqual(hints, [undefined, undefined])

    const claimed = await ctx.quarkActionWorkerState.claimNextAction('worker', directory, new Date().toISOString(), new Date(Date.now() + 60_000).toISOString())
    assert.ok(claimed)
    const retryAt = new Date(Date.now() + 120_000).toISOString()
    await ctx.quarkActionWorkerState.releaseActionClaim({ actionId: claimed.actionId, workerId: 'worker', disposition: 'retry', error: 'temporary', availableAt: retryAt })
    await flushEvents()
    assert.deepEqual(hints, [undefined, undefined, retryAt])
  } finally {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('action worker drains existing durable work immediately on startup', async () => {
  const ctx = new Context()
  const workspace = '/tmp/quark-action-worker-test'
  let claimed = false
  let settled!: () => void
  const completed = new Promise<void>(resolve => { settled = resolve })
  const parent = { session: { header: { cwd: workspace } } } as unknown as Agent
  const state = {
    async claimNextAction() {
      if (claimed) return undefined
      claimed = true
      return {
        actionId: 'startup-action', attempt: 1, approvalGranted: false,
        request: { actionId: 'startup-action', title: 'startup', prompt: 'startup', workspace, mode: 'read-only' as const },
      }
    },
    async settleAction() { settled() },
    async releaseActionClaim() { throw new Error('release must not run') },
  } as unknown as DurableActionWorkerStatePort
  const router = {
    async execute() {
      return { actionId: 'startup-action', executor: 'codex' as const, status: 'completed' as const, summary: 'done', attempts: [], output: [] }
    },
  } as unknown as ExecutorRouterService
  const agents = {
    get() { return undefined },
    async resume() { throw new Error('session not found') },
    async create() { return { agent: parent, async dispose() {} } },
  } as unknown as Context['agents']
  try {
    ctx.provide('quarkActionWorkerState', state)
    ctx.provide('quarkExecutors', router)
    ctx.provide('agents', agents)
    await ctx.plugin(ActionWorkerService, { enabled: true, workerId: 'startup-worker', workspaces: [workspace], pollIntervalMs: 600_000 })
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        completed,
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('startup action wake timed out')), 1_000) }),
      ])
    } finally { if (timeout) clearTimeout(timeout) }
  } finally { await ctx.fiber.dispose() }
})
