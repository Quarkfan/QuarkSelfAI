import assert from 'node:assert/strict'
import test from 'node:test'
import { CompatReadinessObserver, type RuntimeSnapshot } from '../src/runtime/compat.js'

test('waits for both compatibility consumers and handles markers split across chunks', () => {
  const observer = new CompatReadinessObserver()
  let snapshot: RuntimeSnapshot = {
    mode: 'compat',
    state: 'starting',
    messageReady: false,
    cardReady: false,
  }
  snapshot = observer.observe(snapshot, '[event] ready event_key=im.message.re')
  snapshot = observer.observe(snapshot, 'ceive_v1\n[event] ready event_key=card.action.')
  assert.equal(snapshot.state, 'starting')
  snapshot = observer.observe(snapshot, 'trigger\n', 321)
  assert.deepEqual(snapshot, {
    mode: 'compat',
    state: 'ready',
    pid: 321,
    messageReady: true,
    cardReady: true,
  })
})
