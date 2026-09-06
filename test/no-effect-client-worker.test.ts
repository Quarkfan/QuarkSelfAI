import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { NoEffectConfiguredClientPortV1 } from '../src/client-runtime/no-effect-client-worker.js'
import { NoEffectConfiguredClientWorkerV1 } from '../src/client-runtime/no-effect-client-worker.js'

const at = new Date('2026-09-06T00:00:00.000Z')
const emptyReceipt = { schemaVersion: 1 as const, state: 'online-empty' as const, sessionId: 'session.one', taskId: null, planId: null, executorId: null, checkpointDigest: null, executorInvoked: false, effectsActive: 0 as const, externalWritesEnabled: false as const, currentOwnerPreserved: true as const }

test('is inert until explicitly started and serializes recurring no-effect passes', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-worker-')))
  let discoveries = 0; let executions = 0; let callback: (() => void) | undefined; let cancelled = 0
  let release: (() => void) | undefined
  const blocked = new Promise<void>(resolve => { release = resolve })
  const client: NoEffectConfiguredClientPortV1 = {
    async refreshInstalledExecutors() { discoveries += 1; return [] },
    async executeSignedReasoningNoEffectOnce() { executions += 1; if (executions === 1) await blocked; return emptyReceipt },
  }
  try {
    const worker = await NoEffectConfiguredClientWorkerV1.create({ schemaVersion: 1, enabled: true, workspacePath: workspace, cycleIntervalMs: 5_000, discoveryIntervalMs: 30_000, externalWritesEnabled: false }, client, {
      clock: () => at,
      schedule: { schedule(delay, next) { assert.equal(delay, 5_000); callback = next; return 'timer.one' }, cancel(handle) { assert.equal(handle, 'timer.one'); cancelled += 1 } },
    })
    assert.deepEqual(worker.snapshot(), { schemaVersion: 1, state: 'stopped', passCount: 0, lastPassAt: null, lastDiscoveryAt: null, lastReceiptState: null, lastFailure: null, externalWritesEnabled: false })
    worker.start()
    await assert.rejects(async () => worker.start(), /already started/)
    await Promise.resolve(); assert.equal(discoveries, 1); assert.equal(executions, 1); assert.equal(callback, undefined)
    release!(); await new Promise(resolve => setImmediate(resolve)); assert.ok(callback)
    callback!(); callback!(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(executions, 2); assert.equal(discoveries, 1)
    await worker.stop(); assert.equal(cancelled, 1); assert.equal(worker.snapshot().state, 'stopped')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('fails closed to a bounded degraded state and never persists exception text', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-worker-')))
  let scheduled = 0; let cancelled = 0
  const client: NoEffectConfiguredClientPortV1 = {
    async refreshInstalledExecutors() { throw new Error('secret-shaped raw transport failure') },
    async executeSignedReasoningNoEffectOnce() { throw new Error('must not execute') },
  }
  try {
    const worker = await NoEffectConfiguredClientWorkerV1.create({ schemaVersion: 1, enabled: true, workspacePath: workspace, cycleIntervalMs: 5_000, discoveryIntervalMs: 30_000, externalWritesEnabled: false }, client, { clock: () => at, schedule: { schedule() { scheduled += 1; return 'retry.timer' }, cancel(handle) { assert.equal(handle, 'retry.timer'); cancelled += 1 } } })
    worker.start(); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(worker.snapshot(), { schemaVersion: 1, state: 'degraded', passCount: 1, lastPassAt: at.toISOString(), lastDiscoveryAt: null, lastReceiptState: null, lastFailure: 'client-cycle-failed', externalWritesEnabled: false })
    assert.equal(scheduled, 1); await worker.stop(); assert.equal(cancelled, 1)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('waits for its one in-flight pass and does not schedule a replacement during stop', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-worker-')))
  let release: (() => void) | undefined; const blocked = new Promise<void>(resolve => { release = resolve }); let schedules = 0
  const client: NoEffectConfiguredClientPortV1 = { async refreshInstalledExecutors() { return [] }, async executeSignedReasoningNoEffectOnce() { await blocked; return emptyReceipt } }
  try {
    const worker = await NoEffectConfiguredClientWorkerV1.create({ schemaVersion: 1, enabled: true, workspacePath: workspace, cycleIntervalMs: 5_000, discoveryIntervalMs: 30_000, externalWritesEnabled: false }, client, { clock: () => at, schedule: { schedule() { schedules += 1; return 'unexpected' }, cancel() {} } })
    worker.start(); await Promise.resolve()
    const stopping = worker.stop(); assert.equal(worker.snapshot().state, 'stopping')
    release!(); await stopping
    assert.equal(worker.snapshot().state, 'stopped'); assert.equal(schedules, 0)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('rejects open-ended, inactive or aliased worker configuration before use', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-worker-')))
  const client = {} as NoEffectConfiguredClientPortV1
  try {
    await assert.rejects(NoEffectConfiguredClientWorkerV1.create({ schemaVersion: 1, enabled: false, workspacePath: workspace, cycleIntervalMs: 5_000, discoveryIntervalMs: 30_000, externalWritesEnabled: false } as never, client), /invalid/)
    await assert.rejects(NoEffectConfiguredClientWorkerV1.create({ schemaVersion: 1, enabled: true, workspacePath: workspace, cycleIntervalMs: 1, discoveryIntervalMs: 30_000, externalWritesEnabled: false }, client), /invalid/)
    await assert.rejects(NoEffectConfiguredClientWorkerV1.create({ schemaVersion: 1, enabled: true, workspacePath: `${workspace}/..`, cycleIntervalMs: 5_000, discoveryIntervalMs: 30_000, externalWritesEnabled: false }, client), /invalid/)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
