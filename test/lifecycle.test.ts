import assert from 'node:assert/strict'
import test from 'node:test'
import { LifecycleSupervisor, type ManagedComponent } from '../src/platform/lifecycle.js'

function component(
  id: string,
  log: string[],
  options: { startError?: Error; stopError?: Error; failure?: Promise<Error> } = {},
): ManagedComponent {
  return {
    id,
    kind: 'infrastructure',
    async start() {
      log.push(`start:${id}`)
      if (options.startError) throw options.startError
    },
    async stop() {
      log.push(`stop:${id}`)
      if (options.stopError) throw options.stopError
    },
    ...(options.failure ? { waitForFailure: async () => await options.failure as Error } : {}),
  }
}

test('starts components in declaration order and stops them in reverse', async () => {
  const log: string[] = []
  const supervisor = new LifecycleSupervisor([component('store', log), component('kernel', log), component('surface', log)])
  await supervisor.start()
  assert.deepEqual(log, ['start:store', 'start:kernel', 'start:surface'])
  assert.deepEqual(supervisor.snapshot().map(item => item.state), ['ready', 'ready', 'ready'])
  await supervisor.stop()
  assert.deepEqual(log, ['start:store', 'start:kernel', 'start:surface', 'stop:surface', 'stop:kernel', 'stop:store'])
})

test('rolls back already-started components when a later start fails', async () => {
  const log: string[] = []
  const supervisor = new LifecycleSupervisor([
    component('store', log),
    component('kernel', log, { startError: new Error('kernel failed') }),
    component('surface', log),
  ])
  await assert.rejects(supervisor.start(), /kernel failed/)
  assert.deepEqual(log, ['start:store', 'start:kernel', 'stop:kernel', 'stop:store'])
  assert.equal(supervisor.snapshot()[0]?.state, 'stopped')
  assert.equal(supervisor.snapshot()[1]?.state, 'failed')
})

test('preserves start and rollback failures when a partial start cannot be stopped', async () => {
  const log: string[] = []
  const startError = new Error('kernel start failed')
  const stopError = new Error('kernel rollback failed')
  const supervisor = new LifecycleSupervisor([
    component('store', log),
    component('kernel', log, { startError, stopError }),
  ])

  await assert.rejects(supervisor.start(), (error: unknown) => {
    assert.ok(error instanceof AggregateError)
    assert.match(error.message, /kernel start failed/)
    assert.equal(error.errors[0], startError)
    assert.ok(error.errors[1] instanceof AggregateError)
    assert.match(error.errors[1].message, /failed to stop/)
    return true
  })
  assert.deepEqual(log, ['start:store', 'start:kernel', 'stop:kernel', 'stop:store'])
  assert.equal(supervisor.snapshot()[0]?.state, 'stopped')
  assert.deepEqual(supervisor.snapshot()[1], {
    id: 'kernel', kind: 'infrastructure', state: 'failed', lastError: 'kernel start failed',
  })
})

test('surfaces the first critical component failure', async () => {
  let fail!: (error: Error) => void
  const failure = new Promise<Error>(resolve => { fail = resolve })
  const supervisor = new LifecycleSupervisor([component('kernel', [], { failure })])
  await supervisor.start()
  fail(new Error('runtime exited'))
  const result = await supervisor.waitForFailure()
  assert.equal(result.componentId, 'kernel')
  assert.match(result.error.message, /runtime exited/)
  assert.equal(supervisor.snapshot()[0]?.state, 'failed')
  await supervisor.stop()
})

test('normalizes a rejected critical failure watcher', async () => {
  const rejected = {
    ...component('kernel', []),
    waitForFailure: async () => { throw 'watcher disconnected' },
  }
  const supervisor = new LifecycleSupervisor([rejected])
  await supervisor.start()
  const result = await supervisor.waitForFailure()
  assert.equal(result.componentId, 'kernel')
  assert.match(result.error.message, /watcher disconnected/)
  await supervisor.stop()
})

test('rejects duplicate component ids before side effects start', () => {
  assert.throws(() => new LifecycleSupervisor([
    component('same', []), component('same', []),
  ]), /duplicate managed component id/)
})

test('accepts provider-owned component categories but rejects an empty category', () => {
  const custom = { ...component('custom', []), kind: 'future-channel-supervisor' }
  assert.equal(new LifecycleSupervisor([custom]).snapshot()[0]?.kind, 'future-channel-supervisor')
  assert.throws(() => new LifecycleSupervisor([{ ...custom, kind: '' }]), /kind cannot be empty/)
})
