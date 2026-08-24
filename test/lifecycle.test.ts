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
  assert.deepEqual(log, ['start:store', 'start:kernel', 'stop:store'])
  assert.equal(supervisor.snapshot()[0]?.state, 'stopped')
  assert.equal(supervisor.snapshot()[1]?.state, 'failed')
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

test('rejects duplicate component ids before side effects start', () => {
  assert.throws(() => new LifecycleSupervisor([
    component('same', []), component('same', []),
  ]), /duplicate managed component id/)
})
