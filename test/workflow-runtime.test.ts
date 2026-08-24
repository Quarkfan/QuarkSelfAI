import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createSqliteStore } from '../src/storage/sqlite.js'
import { DurableStateService } from '../src/storage/service.js'
import { DEFAULT_WORKFLOW_RECOVERY_POLL_INTERVAL_MS, DurableWorkflowRuntime } from '../src/workflow/runtime.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))

test('uses a ten-minute workflow poll only as restart recovery', () => {
  assert.equal(DEFAULT_WORKFLOW_RECOVERY_POLL_INTERVAL_MS, 600_000)
})

test('workflow storage advances state and effect outbox atomically with idempotent events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-workflow-store-'))
  const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
  try {
    await store.migrate()
    const created = await store.createWorkflow({
      id: 'workflow-1', kind: 'test', definitionVersion: 1, status: 'waiting', state: { step: 0 },
      wakeAt: '2026-08-24T00:00:00.000Z', effects: [{ id: 'effect-1', kind: 'notify', payload: { value: 1 }, availableAt: '2026-08-24T00:00:00.000Z' }],
    })
    assert.equal(created.inserted, true)
    assert.equal((await store.createWorkflow({
      id: 'workflow-1', kind: 'test', definitionVersion: 1, status: 'waiting', state: { step: 0 },
      wakeAt: '2026-08-24T00:00:00.000Z', effects: [{ id: 'effect-1', kind: 'notify', payload: { value: 1 }, availableAt: '2026-08-24T00:00:00.000Z' }],
    })).inserted, false)
    await assert.rejects(store.createWorkflow({
      id: 'workflow-1', kind: 'test', definitionVersion: 1, status: 'waiting', state: { step: 0 },
      wakeAt: '2026-08-24T00:00:00.000Z', effects: [{ id: 'different', kind: 'notify', payload: {} }],
    }), /different durable effects/)
    assert.equal((await store.dueWorkflows('2026-08-24T00:00:01.000Z', 10)).length, 1)
    const event = { id: 'timer:one', type: 'timer', occurredAt: '2026-08-24T00:00:01.000Z', payload: {} }
    const advanced = await store.advanceWorkflow({
      instanceId: 'workflow-1', expectedRevision: 0, event, status: 'completed', state: { step: 1 },
      effects: [{ id: 'effect-2', kind: 'cleanup', payload: { value: 2 }, availableAt: event.occurredAt }],
    })
    assert.equal(advanced.instance.revision, 1)
    assert.equal(advanced.instance.wakeAt, '2026-08-24T00:00:00.000Z')
    assert.equal((await store.advanceWorkflow({
      instanceId: 'workflow-1', expectedRevision: 0, event, status: 'failed', state: { step: 99 },
    })).advanced, false)
    assert.equal((await store.workflow('workflow-1'))?.status, 'completed')

    const first = await store.claimNextWorkflowEffect('worker-1', '2026-08-24T00:00:02.000Z', '2026-08-24T00:01:00.000Z')
    assert.equal(first?.id, 'effect-1')
    await store.releaseWorkflowEffect('effect-1', 'worker-1', 'temporary', '2026-08-24T00:02:00.000Z', false)
    const second = await store.claimNextWorkflowEffect('worker-2', '2026-08-24T00:00:03.000Z', '2026-08-24T00:01:00.000Z')
    assert.equal(second?.id, 'effect-2')
    await store.settleWorkflowEffect('effect-2', 'worker-2', '2026-08-24T00:00:04.000Z')
    const retried = await store.claimNextWorkflowEffect('worker-3', '2026-08-24T00:02:00.000Z', '2026-08-24T00:03:00.000Z')
    assert.equal(retried?.id, 'effect-1')
    assert.equal(retried?.attempt, 2)
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('workflow wake-up supports preserve, clear, and reschedule semantics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-workflow-wake-'))
  const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
  try {
    await store.migrate()
    await store.createWorkflow({ id: 'wake-1', kind: 'test', definitionVersion: 1, status: 'waiting', state: {}, wakeAt: '2026-08-24T01:00:00Z' })
    const preserved = await store.advanceWorkflow({ instanceId: 'wake-1', expectedRevision: 0,
      event: { id: 'preserve', type: 'notice', occurredAt: '2026-08-24T00:00:00Z', payload: {} }, status: 'waiting', state: {} })
    assert.equal(preserved.instance.wakeAt, '2026-08-24T01:00:00Z')
    const cleared = await store.advanceWorkflow({ instanceId: 'wake-1', expectedRevision: 1,
      event: { id: 'clear', type: 'timer', occurredAt: '2026-08-24T01:00:00Z', payload: {} }, status: 'waiting', state: {}, wakeAt: null })
    assert.equal(cleared.instance.wakeAt, undefined)
    const rescheduled = await store.advanceWorkflow({ instanceId: 'wake-1', expectedRevision: 2,
      event: { id: 'reschedule', type: 'retry', occurredAt: '2026-08-24T01:00:01Z', payload: {} }, status: 'waiting', state: {},
      wakeAt: '2026-08-24T02:00:00Z' })
    assert.equal(rescheduled.instance.wakeAt, '2026-08-24T02:00:00Z')
  } finally {
    await store.close(); await rm(directory, { recursive: true, force: true })
  }
})

test('workflow runtime resumes due instances and dispatches durable effects through registered handlers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-workflow-runtime-'))
  const ctx = new Context()
  try {
    const stateFiber = ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'assistant.sqlite3') })
    await stateFiber
    const fiber = ctx.plugin(DurableWorkflowRuntime, { workerId: 'workflow-worker', enabled: false })
    await fiber
    const runtime = ctx.quarkWorkflows
    runtime.register({
      kind: 'counter', version: 1,
      initialize(_input, now) {
        return { status: 'waiting', state: { count: 0 }, wakeAt: now, effects: [{ id: 'started', kind: 'record', payload: { phase: 'started' }, availableAt: now }] }
      },
      reduce(state, event) {
        if (event.type === 'timer') return { status: 'waiting', state: { count: Number(state.count) + 1 } }
        assert.equal(event.type, 'effect.delivered')
        return { status: 'completed', state: { ...state, delivered: event.payload.effectId } }
      },
    })
    const delivered: string[] = []
    runtime.registerEffect('record', { async execute(effect) { delivered.push(effect.id) } })
    await runtime.start('counter-1', 'counter', {}, new Date('2026-08-24T00:00:00.000Z'))
    assert.deepEqual(await runtime.runOnce(new Date('2026-08-24T00:00:01.000Z')), { due: 1, effect: 'delivered' })
    assert.deepEqual(delivered, ['started'])
    assert.deepEqual((await ctx.quarkState.workflow('counter-1'))?.state, { count: 1, delivered: 'started' })
    assert.equal((await ctx.quarkState.workflow('counter-1'))?.status, 'completed')
  } finally {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('durable workflow commits schedule immediate effects without scan latency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-workflow-auto-wake-'))
  const ctx = new Context()
  try {
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'assistant.sqlite3') })
    await ctx.plugin(DurableWorkflowRuntime, { workerId: 'auto-wake-worker', enabled: true, pollIntervalMs: 600_000 })
    ctx.quarkWorkflows.register({
      kind: 'auto-wake', version: 1,
      initialize(_input, now) {
        return { status: 'waiting', state: {}, effects: [{ id: 'immediate', kind: 'record', payload: {}, availableAt: now }] }
      },
      reduce(state, event) {
        return { status: 'completed', state: { ...state, delivered: event.payload.effectId } }
      },
    })
    let delivered!: () => void
    const handled = new Promise<void>((resolve) => { delivered = resolve })
    ctx.quarkWorkflows.registerEffect('record', { async execute() { delivered() } })
    await ctx.quarkWorkflows.start('auto-wake-1', 'auto-wake', {})
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        handled,
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('workflow wake timed out')), 1_000) }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  } finally {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
