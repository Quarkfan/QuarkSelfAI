import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectAllowlistedHostExecutors } from '../src/client-runtime/host-process-probe.js'

const now = new Date('2026-09-06T00:00:00.000Z')

test('runs only immutable allowlisted probes and returns bounded transient observations', async () => {
  const seen: string[] = []
  const observations = await inspectAllowlistedHostExecutors({ run: async executorId => {
    seen.push(executorId)
    return { state: 'completed', exitCode: 0, output: `${executorId} 1.2.3`, authentication: 'unknown' }
  } })
  assert.deepEqual(seen, ['claude-code', 'codex', 'dsh'])
  assert.deepEqual(Object.keys(observations), seen)
})

test('observes missing and timed-out executables without accepting command input', async () => {
  let index = 0
  const observations = await inspectAllowlistedHostExecutors({ run: async () => {
    index += 1
    return index === 1
      ? { state: 'not-found', exitCode: null, output: '', authentication: 'unknown' }
      : { state: 'timed-out', exitCode: null, output: '', authentication: 'unknown' }
  } })
  assert.deepEqual(Object.values(observations).map(report => report.state), ['not-found', 'timed-out', 'timed-out'])
})
