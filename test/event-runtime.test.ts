import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { DEFAULT_EVENT_RECOVERY_POLL_INTERVAL_MS, DurableEventRuntime } from '../src/events/runtime.js'
import { DurableStateService } from '../src/storage/service.js'
import { createSqliteStore } from '../src/storage/sqlite.js'
import { fileURLToPath } from 'node:url'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))
const event = (id: string) => ({ kind: 'message.received' as const, source: { channel: 'feishu' as const, resourceId: id }, eventKey: 'im.message.receive_v1', deduplicationKey: id, payload: { content: id }, raw: { message_id: id } })

test('uses a ten-minute poll only as missed-wake recovery', () => {
  assert.equal(DEFAULT_EVENT_RECOVERY_POLL_INTERVAL_MS, 600_000)
})

test('durable inbox gives each consumer an independent lease and retry cursor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-event-store-')); const store = await createSqliteStore(join(directory, 'state.sqlite3'), migrations)
  try {
    await store.migrate(); await store.appendEvent('event-1', event('om-1'))
    const first = await store.claimNextEvent('consumer-a', ['im.message.receive_v1'], 'worker-a', '2026-08-24T00:00:00Z', '2026-08-24T00:01:00Z')
    const independent = await store.claimNextEvent('consumer-b', ['im.message.receive_v1'], 'worker-b', '2026-08-24T00:00:00Z', '2026-08-24T00:01:00Z')
    assert.equal(first?.id, 'event-1'); assert.equal(independent?.id, 'event-1')
    await store.settleEvent('consumer-a', 'event-1', 'worker-a', '2026-08-24T00:00:01Z')
    await store.releaseEvent({ consumerName: 'consumer-b', eventId: 'event-1', workerId: 'worker-b', error: 'retry', availableAt: '2026-08-24T00:02:00Z', terminal: false })
    assert.equal(await store.claimNextEvent('consumer-a', ['im.message.receive_v1'], 'worker-a', '2026-08-24T00:03:00Z', '2026-08-24T00:04:00Z'), undefined)
    assert.equal(await store.claimNextEvent('consumer-b', ['im.message.receive_v1'], 'worker-b', '2026-08-24T00:01:00Z', '2026-08-24T00:02:00Z'), undefined)
    assert.equal((await store.claimNextEvent('consumer-b', ['im.message.receive_v1'], 'worker-b', '2026-08-24T00:02:00Z', '2026-08-24T00:03:00Z'))?.attempt, 2)
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }) }
})

test('durable event runtime retries the same journal event after a handler failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-event-runtime-')); const ctx = new Context()
  try {
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'state.sqlite3') })
    await ctx.plugin(DurableEventRuntime, { workerId: 'event-worker', enabled: false, retryDelayMs: 1_000, maxAttempts: 3 })
    let attempts = 0; ctx.quarkEvents.register({ name: 'intake', eventKeys: ['im.message.receive_v1'], async handle() { attempts += 1; if (attempts === 1) throw new Error('temporary') } })
    await ctx.quarkEventAppendState.appendEvent(event('om-1'))
    assert.deepEqual(await ctx.quarkEvents.runOnce(new Date('2026-08-24T00:00:00Z')), { claimed: 1, delivered: 0, failed: 0 })
    assert.deepEqual(await ctx.quarkEvents.runOnce(new Date('2026-08-24T00:00:00.500Z')), { claimed: 0, delivered: 0, failed: 0 })
    assert.deepEqual(await ctx.quarkEvents.runOnce(new Date('2026-08-24T00:00:01Z')), { claimed: 1, delivered: 1, failed: 0 })
    assert.equal(attempts, 2)
  } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('durable append wakes event consumers instead of waiting for recovery polling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-event-wake-')); const ctx = new Context()
  try {
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'state.sqlite3') })
    await ctx.plugin(DurableEventRuntime, { workerId: 'wake-worker', enabled: true, pollIntervalMs: 600_000 })
    let delivered!: () => void
    const handled = new Promise<void>((resolve) => { delivered = resolve })
    ctx.quarkEvents.register({ name: 'intake', eventKeys: ['im.message.receive_v1'], async handle() { delivered() } })
    await ctx.quarkEventAppendState.appendEvent(event('om-wake'))
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        handled,
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('event wake timed out')), 1_000) }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('failed event delivery wakes again at its exact retry deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-event-retry-wake-')); const ctx = new Context()
  try {
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'state.sqlite3') })
    await ctx.plugin(DurableEventRuntime, { workerId: 'retry-wake-worker', enabled: true, pollIntervalMs: 600_000, retryDelayMs: 30, maxAttempts: 3 })
    let attempts = 0
    let completed!: () => void
    const handled = new Promise<void>(resolve => { completed = resolve })
    ctx.quarkEvents.register({
      name: 'retry-intake', eventKeys: ['im.message.receive_v1'],
      async handle() { attempts += 1; if (attempts === 1) throw new Error('temporary'); completed() },
    })
    await ctx.quarkEventAppendState.appendEvent(event('om-retry-wake'))
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        handled,
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('event retry wake timed out')), 1_000) }),
      ])
    } finally { if (timeout) clearTimeout(timeout) }
    assert.equal(attempts, 2)
  } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
})
