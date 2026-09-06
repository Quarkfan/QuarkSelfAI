import assert from 'node:assert/strict'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runReasoningExecutorPilot } from '../scripts/run-reasoning-executor-pilot.js'

const now = new Date('2026-09-06T08:00:00.000Z')

test('runs one selected reasoning executor and removes all temporary state', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-reasoning-pilot-test-')))
  const calls: string[] = []
  try {
    const receipt = await runReasoningExecutorPilot(now, undefined, {
      temporaryParent: parent,
      inspectReadiness: async () => [
        { schemaVersion: 1, executorId: 'claude-code', installation: 'detected', version: '1', authentication: 'ready', checkedAt: now.toISOString() },
        { schemaVersion: 1, executorId: 'codex', installation: 'detected', version: '1', authentication: 'ready', checkedAt: now.toISOString() },
      ],
      execute: async input => {
        calls.push(input.executorId)
        assert.equal(input.plan.envelope.program.goals.length, 1)
        return { outcome: 'succeeded', summaryCode: 'executor.reasoning-completed', artifactDigests: [`sha256:${'b'.repeat(64)}`] }
      },
    })
    assert.equal(receipt.executorId, 'claude-code')
    assert.deepEqual(calls, ['claude-code'])
    assert.deepEqual(await readdir(parent), [])
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('does not switch executors after a selected action fails', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-reasoning-pilot-test-')))
  const calls: string[] = []
  try {
    await assert.rejects(runReasoningExecutorPilot(now, 'codex', {
      temporaryParent: parent,
      inspectReadiness: async () => [
        { schemaVersion: 1, executorId: 'claude-code', installation: 'detected', version: '1', authentication: 'ready', checkedAt: now.toISOString() },
        { schemaVersion: 1, executorId: 'codex', installation: 'detected', version: '1', authentication: 'ready', checkedAt: now.toISOString() },
      ],
      execute: async input => { calls.push(input.executorId); throw new Error('bounded failure') },
    }), /bounded failure/)
    assert.deepEqual(calls, ['codex'])
    assert.deepEqual(await readdir(parent), [])
  } finally { await rm(parent, { recursive: true, force: true }) }
})
