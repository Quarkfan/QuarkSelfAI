import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { terminateChildGracefully } from '../src/runtime/child-process.js'

test('graceful child termination clears a long timeout after an early exit', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"])
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  const started = Date.now()
  assert.equal(await terminateChildGracefully(child, 15_000), true)
  assert.ok(Date.now() - started < 2_000)
})

test('graceful child termination rejects invalid timeouts before signaling', async () => {
  const fake = { exitCode: null, signalCode: null, kill: () => { throw new Error('must not signal') } }
  for (const timeoutMs of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(terminateChildGracefully(fake as never, timeoutMs), /timeoutMs must be a positive safe integer/)
  }
})
