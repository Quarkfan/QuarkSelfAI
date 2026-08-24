import assert from 'node:assert/strict'
import test from 'node:test'
import { DurableWakeScheduler } from '../src/runtime/wake-scheduler.js'

async function eventually(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('durable wake scheduler coalesces immediate commit hints', async () => {
  let runs = 0
  const scheduler = new DurableWakeScheduler({
    enabled: true, recoveryIntervalMs: 600_000,
    async run() { runs += 1; return runs },
    continueAfter: () => false,
    onError(error) { throw error },
  })
  try {
    scheduler.wake(); scheduler.wake(); scheduler.wake()
    await eventually(() => runs === 1)
  } finally { scheduler.dispose() }
})

test('durable wake scheduler keeps the earliest exact deadline', async () => {
  const started = Date.now()
  let ranAt = 0
  const scheduler = new DurableWakeScheduler({
    enabled: true, recoveryIntervalMs: 600_000,
    async run() { ranAt = Date.now(); return true },
    continueAfter: () => false,
    onError(error) { throw error },
  })
  try {
    scheduler.wake(new Date(started + 80).toISOString())
    scheduler.wake(new Date(started + 30).toISOString())
    scheduler.wake(new Date(started + 120).toISOString())
    await eventually(() => ranAt > 0)
    assert.ok(ranAt >= started + 20, `deadline fired too early: ${ranAt - started}ms`)
    assert.ok(ranAt < started + 110, `earliest deadline was not retained: ${ranAt - started}ms`)
  } finally { scheduler.dispose() }
})

test('disposing a durable wake scheduler cancels pending work', async () => {
  let runs = 0
  const scheduler = new DurableWakeScheduler({
    enabled: true, recoveryIntervalMs: 600_000,
    async run() { runs += 1; return true },
    continueAfter: () => false,
    onError(error) { throw error },
  })
  scheduler.wake(new Date(Date.now() + 20).toISOString())
  scheduler.dispose()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(runs, 0)
})
