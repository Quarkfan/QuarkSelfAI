import assert from 'node:assert/strict'
import { type ChildProcessWithoutNullStreams, type spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LarkEventStream } from '../src/lark/stream.js'

const eventKey = 'im.message.receive_v1'

class FakeCli extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: string[] = []
  exitCode: number | null = null
  autoClose = true

  kill(signal = 'SIGTERM'): boolean {
    this.signals.push(signal)
    if (this.autoClose) queueMicrotask(() => this.close(0))
    return true
  }

  close(code: number): void {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.emit('close', code, null)
  }

  ready(): void { this.stderr.write(`[event] ready event_key=${eventKey}\n`) }
  event(messageId: string): void { this.stdout.write(`${JSON.stringify({ message_id: messageId, content: messageId })}\n`) }
}

function stream(child: FakeCli): LarkEventStream {
  const fakeSpawn = (() => child as unknown as ChildProcessWithoutNullStreams) as typeof spawn
  return new LarkEventStream(fakeSpawn)
}

async function until(check: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('expected stream state was not reached')
}

test('waits for exact CLI ready marker and serializes durable callbacks', async () => {
  const child = new FakeCli()
  const subject = stream(child)
  const handled: string[] = []
  let releaseFirst: (() => void) | undefined
  const firstPending = new Promise<void>(resolve => { releaseFirst = resolve })
  const starting = subject.start({ eventKey, identity: 'bot' }, async event => {
    const messageId = event.source.resourceId!
    handled.push(`start:${messageId}`)
    if (messageId === 'one') await firstPending
    handled.push(`done:${messageId}`)
  })
  child.stderr.write('[event] ready event_key=other\n')
  assert.equal(subject.status(), 'starting')
  child.ready()
  await starting
  child.event('one')
  child.event('two')
  await until(() => handled.includes('start:one'))
  assert.deepEqual(handled, ['start:one'])
  releaseFirst?.()
  await until(() => handled.includes('done:two'))
  assert.deepEqual(handled, ['start:one', 'done:one', 'start:two', 'done:two'])
  await subject.stop()
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(subject.status(), 'idle')
})

test('reports callback and malformed payload failures without exposing message text', async () => {
  for (const mode of ['callback', 'payload'] as const) {
    const child = new FakeCli()
    const subject = stream(child)
    const failures: string[] = []
    const starting = subject.start({ eventKey, identity: 'bot', onFailure: error => failures.push(error.message) }, async () => {
      if (mode === 'callback') throw new Error('private message body')
    })
    child.ready()
    await starting
    if (mode === 'callback') child.event('one')
    else child.stdout.write('{invalid json\n')
    await until(() => subject.status() === 'failed')
    assert.equal(failures.length, 1)
    assert.match(failures[0]!, /event-handler-or-payload/)
    assert.doesNotMatch(failures[0]!, /private message body/)
    await subject.stop()
  }
})

test('unexpected exit and startup timeout remain observable and do not auto-restart', async () => {
  const child = new FakeCli()
  const subject = stream(child)
  const failures: string[] = []
  const starting = subject.start({ eventKey, identity: 'bot', onFailure: error => failures.push(error.message) }, async () => {})
  child.ready()
  await starting
  child.close(7)
  await until(() => subject.status() === 'failed')
  assert.match(failures[0]!, /unexpected-close\.7/)
  await assert.rejects(() => subject.start({ eventKey, identity: 'bot' }, async () => {}), /not been fully stopped/)
  await subject.stop()

  const slow = new FakeCli()
  const timed = stream(slow)
  await assert.rejects(() => timed.start({ eventKey, identity: 'bot', readyTimeoutMs: 10 }, async () => {}), /ready-timeout/)
  await timed.stop()
})

test('graceful stop timeout never SIGKILLs and preserves uncertain owner until close', async () => {
  const child = new FakeCli()
  child.autoClose = false
  const subject = stream(child)
  const starting = subject.start({ eventKey, identity: 'bot' }, async () => {})
  child.ready()
  await starting
  await assert.rejects(() => subject.stop(10), /ownership is uncertain/)
  assert.deepEqual(child.signals, ['SIGTERM'])
  await assert.rejects(() => subject.start({ eventKey, identity: 'bot' }, async () => {}), /not been fully stopped/)
  child.close(0)
  await subject.stop()
  assert.equal(subject.status(), 'idle')
})

test('stop waits for an in-flight journal callback before declaring the stream stopped', async () => {
  const child = new FakeCli()
  const subject = stream(child)
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  let entered = false
  const starting = subject.start({ eventKey, identity: 'bot' }, async () => { entered = true; await pending })
  child.ready()
  await starting
  child.event('one')
  await until(() => entered)
  await assert.rejects(() => subject.stop(10), /ownership is uncertain/)
  assert.equal(subject.status(), 'failed')
  release?.()
  await subject.stop()
  assert.equal(subject.status(), 'idle')
})
