import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { issueDurableExecutorAuthorization, type DurableExecutorAuthorization } from '../src/execution/claim-authorization.js'
import { SequentialExecutorRouter, type SubagentDispatcher } from '../src/execution/router.js'
import { WorkspacePolicy } from '../src/execution/workspace-policy.js'

const providers = {
  'claude-code': { readOnly: 'quark-claude-code-read', write: 'quark-claude-code-write' },
  codex: { readOnly: 'quark-codex-read', write: 'quark-codex-write' },
  'dsh-native': { readOnly: 'spawn', write: 'spawn' },
}
const routes = { 'claude-code': ['claude-code', 'codex'], codex: ['codex'], 'dsh-native': ['dsh-native'] }

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
  const router = new SequentialExecutorRouter(dispatcher, policy, providers, routes, 'claude-code')
  return { workspace, calls, disposed, router }
}

function request(workspace: string) {
  return {
    actionId: 'action-1', title: 'fixture', prompt: 'perform the fixture', workspace,
    mode: 'read-only' as const, parent: parent(workspace),
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

test('requires an opaque durable claim capability before a workspace or external write', async () => {
  const h = await harness([])
  const write = { ...request(h.workspace), mode: 'workspace-write' as const }
  assert.throws(() => issueDurableExecutorAuthorization(write, false), /requires an approved durable action claim/)
  await assert.rejects(h.router.execute(write, new AbortController().signal), /requires an approved durable action claim/)
  await assert.rejects(h.router.execute({
    ...write, authorization: {} as DurableExecutorAuthorization,
  }, new AbortController().signal), /invalid durable action claim authorization/)
  assert.deepEqual(h.calls, [])
})

test('routes an approved write only to the write-capable provider', async () => {
  const h = await harness([{ stopReason: 'completed', output: [{ type: 'text', text: 'approved write done' }] }])
  const write = { ...request(h.workspace), mode: 'workspace-write' as const }
  const result = await h.router.execute({
    ...write, authorization: issueDurableExecutorAuthorization(write, true),
  }, new AbortController().signal)
  assert.equal(result.status, 'completed')
  assert.deepEqual(h.calls, ['quark-claude-code-write'])
})

test('binds a durable claim capability to one exact request and consumes it once', async () => {
  const h = await harness([{ stopReason: 'completed', output: [] }])
  const write = { ...request(h.workspace), mode: 'external-write' as const }
  const authorization = issueDurableExecutorAuthorization(write, true)
  await assert.rejects(h.router.execute({
    ...write, prompt: 'mutated prompt', authorization,
  }, new AbortController().signal), /invalid durable action claim authorization/)
  await assert.rejects(h.router.execute({ ...write, authorization }, new AbortController().signal), /invalid durable action claim authorization/)
  assert.deepEqual(h.calls, [])
})

test('supports explicit DSH-native execution without entering the Claude fallback route', async () => {
  const h = await harness([{ stopReason: 'completed', output: [{ type: 'text', text: 'done natively' }] }])
  const result = await h.router.execute({ ...request(h.workspace), requestedExecutor: 'dsh-native' }, new AbortController().signal)
  assert.equal(result.executor, 'dsh-native')
  assert.deepEqual(h.calls, ['spawn'])
})

test('accepts a new harness through configuration without changing the router kernel', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'quark-executor-router-custom-'))
  const calls: string[] = []
  const dispatcher: SubagentDispatcher = { async start(provider) { calls.push(provider); return run('custom-session', { stopReason: 'completed', output: [] }, []) } }
  const policy = await WorkspacePolicy.create([workspace])
  const router = new SequentialExecutorRouter(dispatcher, policy, { custom: { readOnly: 'custom-read', write: 'custom-write' } }, { custom: ['custom'] }, 'custom')
  const result = await router.execute(request(workspace), new AbortController().signal)
  assert.equal(result.executor, 'custom')
  assert.deepEqual(calls, ['custom-read'])
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
  const router = new SequentialExecutorRouter(dispatcher, policy, providers, routes, 'claude-code')
  const first = router.execute(request(workspace), new AbortController().signal)
  await started.promise
  await assert.rejects(router.execute(request(workspace), new AbortController().signal), /already has an active executor/)
  pending.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done once' }] })
  assert.equal((await first).status, 'completed')
})
