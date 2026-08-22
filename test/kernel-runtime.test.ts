import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DshKernelRuntime } from '../src/runtime/kernel.js'

test('starts a supervised local kernel and stops it gracefully', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-kernel-'))
  const fixture = join(directory, 'kernel.mjs')
  await writeFile(fixture, "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)\n")
  const runtime = new DshKernelRuntime({
    command: process.execPath,
    args: [fixture],
    cwd: directory,
    home: join(directory, 'dsh-home'),
    profile: 'fixture',
    stabilizationMs: 25,
  })
  await runtime.start()
  assert.equal(runtime.snapshot().state, 'ready')
  assert.ok(runtime.snapshot().pid)
  await runtime.stop()
  assert.deepEqual(runtime.snapshot(), { mode: 'dsh', state: 'stopped', profile: 'fixture' })
})

test('surfaces a kernel crash to the outer daemon', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-kernel-failure-'))
  const fixture = join(directory, 'kernel.mjs')
  await writeFile(fixture, 'setTimeout(() => process.exit(9), 75)\n')
  const runtime = new DshKernelRuntime({
    command: process.execPath,
    args: [fixture],
    cwd: directory,
    home: join(directory, 'dsh-home'),
    profile: 'fixture',
    stabilizationMs: 20,
  })
  await runtime.start()
  const failure = await runtime.waitForFailure()
  assert.match(failure.message, /code=9/)
  assert.equal(runtime.snapshot().state, 'failed')
})
