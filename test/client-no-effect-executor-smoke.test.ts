import assert from 'node:assert/strict'
import test from 'node:test'
import { runNoEffectExecutorSmoke, type FixedNoEffectSmokeRunnerV1 } from '../src/client-runtime/no-effect-executor-smoke.js'

const dsh = { schemaVersion: 1 as const, executorId: 'dsh' as const, installation: 'detected' as const, version: '1.0.0', inferenceConfigured: false, authentication: 'required' as const, protocolVersions: [], capabilities: [] }
const ready = (executorId: 'claude-code' | 'codex') => ({ executorId, installation: 'detected' as const, authentication: 'ready' as const, checkedAt: '2026-09-06T00:00:00.000Z' })

test('invokes only the first authenticated executor and returns no model content', async () => {
  const calls: string[] = []
  const runner: FixedNoEffectSmokeRunnerV1 = { run: async id => { calls.push(id); return { exitCode: 0, timedOut: false, output: JSON.stringify({ result: 'QUARK_PILOT_OK', account: 'must-not-return' }), durationMs: 12 } } }
  const receipt = await runNoEffectExecutorSmoke({ auth: [ready('claude-code'), ready('codex')], dsh, cwd: '/tmp/empty' }, runner)
  assert.deepEqual(calls, ['claude-code'])
  assert.deepEqual({ executor: receipt.executorId, attempts: receipt.attemptCount, tools: receipt.toolsEnabled, effects: receipt.effectsActive }, { executor: 'claude-code', attempts: 1, tools: false, effects: 0 })
  assert.equal(JSON.stringify(receipt).includes('QUARK_PILOT_OK'), false)
  assert.equal(JSON.stringify(receipt).includes('must-not-return'), false)
  assert.match(receipt.contentDigest, /^sha256:[a-f0-9]{64}$/)
})

test('does not retry malformed or failed output on a second executor', async () => {
  const calls: string[] = []
  const runner: FixedNoEffectSmokeRunnerV1 = { run: async id => { calls.push(id); return { exitCode: 0, timedOut: false, output: JSON.stringify({ result: 'different' }), durationMs: 1 } } }
  await assert.rejects(() => runNoEffectExecutorSmoke({ auth: [ready('claude-code'), ready('codex')], dsh, cwd: '/tmp/empty' }, runner), /invalid/)
  assert.deepEqual(calls, ['claude-code'])
})

test('fails closed when no executor is authenticated', async () => {
  const unavailable = { ...ready('claude-code'), authentication: 'required' as const }
  await assert.rejects(() => runNoEffectExecutorSmoke({ auth: [unavailable], dsh, cwd: '/tmp/empty' }, { run: async () => { throw new Error('must not run') } }), /no authenticated executor/)
})
