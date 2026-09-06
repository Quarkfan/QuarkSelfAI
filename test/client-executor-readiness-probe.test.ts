import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectExecutorReadiness, type FixedAuthProbeRunnerV1 } from '../src/client-runtime/executor-readiness-probe.js'

const now = new Date('2026-09-06T00:00:00.000Z')
function runner(values: Record<string, { state: 'completed' | 'not-found' | 'timed-out'; exitCode: number | null; output: string }>): FixedAuthProbeRunnerV1 { return { run: async id => values[id]! } }

test('classifies fixed Claude and Codex authentication without returning process output', async () => {
  const results = await inspectExecutorReadiness('/tmp/empty', now, runner({
    'claude-code': { state: 'completed', exitCode: 0, output: JSON.stringify({ loggedIn: true, account: 'must-not-return' }) },
    codex: { state: 'completed', exitCode: 0, output: 'Logged in using ChatGPT' },
  }))
  assert.deepEqual(results.map(item => [item.executorId, item.installation, item.authentication]), [['claude-code', 'detected', 'ready'], ['codex', 'detected', 'ready']])
  assert.equal(JSON.stringify(results).includes('must-not-return'), false)
  assert.equal(JSON.stringify(results).includes('ChatGPT'), false)
})

test('fails closed for malformed, missing and timed-out authentication probes', async () => {
  const results = await inspectExecutorReadiness('/tmp/empty', now, runner({
    'claude-code': { state: 'completed', exitCode: 0, output: '{bad' },
    codex: { state: 'timed-out', exitCode: null, output: 'ignored' },
  }))
  assert.deepEqual(results.map(item => item.authentication), ['unknown', 'unknown'])
})
