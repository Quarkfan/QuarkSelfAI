import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RoutedExecutorResult } from '../src/execution/router.js'
import {
  DurableExecutorWorker, type DurableActionAgentHost, type DurableExecutorRoute,
} from '../src/execution/worker.js'
import { createSqliteStore } from '../src/storage/sqlite.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))

function parent(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

function agents(cwd: string, acquired: string[] = []): DurableActionAgentHost {
  return {
    async acquire(actionId) {
      acquired.push(actionId)
      return { parent: parent(cwd), sessionId: `session:${actionId}`, async dispose() {} }
    },
  }
}

test('durable worker defers infrastructure failure and resumes the same action once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-durable-worker-'))
  const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
  try {
    await store.migrate()
    await store.enqueueAction({
      actionId: 'action-retry', matterId: 'matter-retry', matterTitle: 'Retry', matterSummary: 'retry once', intent: 'read',
      source: { channel: 'feishu', resourceId: 'om-retry' },
      request: { title: 'Retry', prompt: 'read', workspace: directory, mode: 'read-only' },
    })
    const results: RoutedExecutorResult[] = [
      {
        actionId: 'action-retry', executor: 'codex', status: 'failed', summary: 'connection timeout', output: [],
        attempts: [
          { executor: 'claude-code', provider: 'claude-read', status: 'failed', failureStage: 'run', failureReason: 'network timeout' },
          { executor: 'codex', provider: 'codex-read', status: 'failed', failureStage: 'start', failureReason: 'connection reset' },
        ],
      },
      {
        actionId: 'action-retry', executor: 'claude-code', status: 'completed', summary: 'done', output: [],
        attempts: [{ executor: 'claude-code', provider: 'claude-read', status: 'completed' }],
      },
    ]
    const route: DurableExecutorRoute = { async execute() { return results.shift() as RoutedExecutorResult } }
    const acquired: string[] = []
    const worker = new DurableExecutorWorker(store, route, agents(directory, acquired), {
      workerId: 'worker-retry', workspace: directory, leaseMs: 60_000, retryDelayMs: 120_000, maxAttempts: 3,
    })
    assert.equal((await worker.runOnce(new AbortController().signal, new Date('2099-01-01T00:00:00.000Z'))).status, 'deferred')
    assert.equal((await worker.runOnce(new AbortController().signal, new Date('2099-01-01T00:01:00.000Z'))).status, 'idle')
    const resumed = await worker.runOnce(new AbortController().signal, new Date('2099-01-01T00:02:00.000Z'))
    assert.equal(resumed.status, 'completed')
    assert.equal(resumed.attempt, 2)
    assert.deepEqual(acquired, ['action-retry', 'action-retry'])
    assert.equal((await store.recentActions(10))[0]?.state, 'completed')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('durable worker does not retry a deterministic boundary failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-durable-worker-failed-'))
  const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
  try {
    await store.migrate()
    await store.enqueueAction({
      actionId: 'action-failed', matterId: 'matter-failed', matterTitle: 'Fail', matterSummary: 'fail once', intent: 'read',
      source: { channel: 'feishu', resourceId: 'om-failed' },
      request: { title: 'Fail', prompt: 'read', workspace: directory, mode: 'read-only' },
    })
    const route: DurableExecutorRoute = { async execute() { throw new Error('workspace policy rejected request') } }
    const worker = new DurableExecutorWorker(store, route, agents(directory), { workerId: 'worker-failed', workspace: directory })
    const result = await worker.runOnce(new AbortController().signal, new Date('2099-01-01T00:00:00.000Z'))
    assert.equal(result.status, 'failed')
    assert.equal((await store.recentActions(10))[0]?.state, 'failed')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('durable worker releases an action when its exact DSH parent is interrupted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-durable-worker-abort-'))
  const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
  try {
    await store.migrate()
    await store.enqueueAction({
      actionId: 'action-abort', matterId: 'matter-abort', matterTitle: 'Abort', matterSummary: 'resume later', intent: 'read',
      source: { channel: 'feishu', resourceId: 'om-abort' },
      request: { title: 'Abort', prompt: 'read', workspace: directory, mode: 'read-only' },
    })
    const route: DurableExecutorRoute = { async execute() { throw new Error('route must not run') } }
    const interrupted: DurableActionAgentHost = { async acquire() { throw new Error('operation aborted during shutdown') } }
    const worker = new DurableExecutorWorker(store, route, interrupted, {
      workerId: 'worker-abort', workspace: directory, retryDelayMs: 60_000,
    })
    const result = await worker.runOnce(new AbortController().signal, new Date('2099-01-01T00:00:00.000Z'))
    assert.equal(result.status, 'deferred')
    assert.equal((await store.recentActions(10))[0]?.state, 'planned')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
