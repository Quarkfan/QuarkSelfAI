import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { SequentialExecutorRouter, type SubagentDispatcher } from '../src/execution/router.js'
import { WorkspacePolicy } from '../src/execution/workspace-policy.js'

function parent(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

function run(id: string, result: SubagentResult, disposed: string[]): SubagentRun {
  return {
    id: id as SubagentRun['id'],
    localAgent: undefined,
    result: Promise.resolve(result),
    async dispose() { disposed.push(id) },
  }
}

async function harness(results: Array<SubagentResult | Error>) {
  const workspace = await mkdtemp(join(tmpdir(), 'quark-executor-router-'))
  const calls: string[] = []
  const disposed: string[] = []
  const dispatcher: SubagentDispatcher = {
    async start(provider) {
      calls.push(provider)
      const next = results.shift()
      if (next instanceof Error) throw next
      if (!next) throw new Error('missing fixture result')
      return run(`session-${calls.length}`, next, disposed)
    },
  }
  const policy = await WorkspacePolicy.create([workspace])
  const router = new SequentialExecutorRouter(dispatcher, policy, {
    'claude-code': { readOnly: 'quark-claude-code-read', write: 'quark-claude-code-write' },
    codex: { readOnly: 'quark-codex-read', write: 'quark-codex-write' },
    'dsh-native': { readOnly: 'spawn', write: 'spawn' },
  })
  return { workspace, calls, disposed, router }
}

function request(workspace: string) {
  return {
    actionId: 'action-1', title: 'fixture', prompt: 'perform the fixture', workspace,
    mode: 'read-only' as const, approvalGranted: false, parent: parent(workspace),
  }
}

test('uses Claude first and disposes its run before returning', async () => {
  const h = await harness([{ stopReason: 'completed', output: [{ type: 'text', text: 'done by Claude' }] }])
  const result = await h.router.execute(request(h.workspace), new AbortController().signal)
  assert.equal(result.executor, 'claude-code')
  assert.deepEqual(h.calls, ['quark-claude-code-read'])
  assert.deepEqual(h.disposed, ['session-1'])
})

test('falls back to Codex only after a Claude infrastructure failure', async () => {
  const h = await harness([
    { stopReason: 'error', diagnostic: 'transport connection timeout', output: [] },
    { stopReason: 'completed', output: [{ type: 'text', text: 'done by Codex' }] },
  ])
  const result = await h.router.execute(request(h.workspace), new AbortController().signal)
  assert.equal(result.executor, 'codex')
  assert.deepEqual(h.calls, ['quark-claude-code-read', 'quark-codex-read'])
  assert.deepEqual(h.disposed, ['session-1', 'session-2'])
  assert.equal(result.attempts[0]?.failureStage, 'run')
})

test('does not duplicate deterministic Claude failures on Codex', async () => {
  const h = await harness([{ stopReason: 'error', diagnostic: 'invalid output schema', output: [] }])
  const result = await h.router.execute(request(h.workspace), new AbortController().signal)
  assert.equal(result.status, 'failed')
  assert.deepEqual(h.calls, ['quark-claude-code-read'])
})

test('requires owner approval before a workspace or external write', async () => {
  const h = await harness([])
  await assert.rejects(h.router.execute({ ...request(h.workspace), mode: 'workspace-write' }, new AbortController().signal), /requires a durable owner approval/)
  assert.deepEqual(h.calls, [])
})

test('routes an approved write only to the write-capable provider', async () => {
  const h = await harness([{ stopReason: 'completed', output: [{ type: 'text', text: 'approved write done' }] }])
  const result = await h.router.execute({
    ...request(h.workspace), mode: 'workspace-write', approvalGranted: true,
  }, new AbortController().signal)
  assert.equal(result.status, 'completed')
  assert.deepEqual(h.calls, ['quark-claude-code-write'])
})

test('supports explicit DSH-native execution without entering the Claude fallback route', async () => {
  const h = await harness([{ stopReason: 'completed', output: [{ type: 'text', text: 'done natively' }] }])
  const result = await h.router.execute({ ...request(h.workspace), requestedExecutor: 'dsh-native' }, new AbortController().signal)
  assert.equal(result.executor, 'dsh-native')
  assert.deepEqual(h.calls, ['spawn'])
})

test('rejects concurrent execution of the same durable action', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'quark-executor-router-active-'))
  const pending = Promise.withResolvers<SubagentResult>()
  const started = Promise.withResolvers<void>()
  const dispatcher: SubagentDispatcher = {
    async start() {
      started.resolve()
      return {
        id: 'session-active' as SubagentRun['id'],
        localAgent: undefined,
        result: pending.promise,
        async dispose() {},
      }
    },
  }
  const policy = await WorkspacePolicy.create([workspace])
  const router = new SequentialExecutorRouter(dispatcher, policy, {
    'claude-code': { readOnly: 'quark-claude-code-read', write: 'quark-claude-code-write' },
    codex: { readOnly: 'quark-codex-read', write: 'quark-codex-write' },
    'dsh-native': { readOnly: 'spawn', write: 'spawn' },
  })
  const first = router.execute(request(workspace), new AbortController().signal)
  await started.promise
  await assert.rejects(router.execute(request(workspace), new AbortController().signal), /already has an active executor/)
  pending.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done once' }] })
  assert.equal((await first).status, 'completed')
})
