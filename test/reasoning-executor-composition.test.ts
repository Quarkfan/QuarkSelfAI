import assert from 'node:assert/strict'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { FixedReasoningInvocationV1 } from '../src/client-runtime/reasoning-executor-adapter.js'
import { createProductReasoningExecutors } from '../src/client-runtime/reasoning-executor-composition.js'

test('composes all three product executors without selecting or invoking one', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-reasoning-composition-')))
  let calls = 0
  try {
    const executors = await createProductReasoningExecutors(join(parent, 'runtime'), join(parent, 'results'), {
      runner: { async run(_invocation: FixedReasoningInvocationV1) { calls += 1; throw new Error('must not run during composition') } },
    })
    assert.deepEqual(executors.map(item => item.executorId), ['claude-code', 'codex', 'dsh'])
    assert.equal(calls, 0)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('rejects aliased or relative execution roots before composition', async () => {
  await assert.rejects(createProductReasoningExecutors('relative', '/private/tmp/results'), /exact absolute/)
  await assert.rejects(createProductReasoningExecutors('/private/tmp/../tmp/runtime', '/private/tmp/results'), /exact absolute/)
})

test('rejects a runtime root that is readable by other local users', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-reasoning-composition-')))
  const runtime = join(parent, 'runtime')
  try {
    await createProductReasoningExecutors(runtime, join(parent, 'results'))
    await chmod(runtime, 0o755)
    await assert.rejects(createProductReasoningExecutors(runtime, join(parent, 'results')), /private canonical/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
