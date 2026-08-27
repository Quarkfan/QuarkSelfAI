import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompatReadinessObserver, CompatRuntime, type RuntimeSnapshot } from '../src/runtime/compat.js'

test('waits for both compatibility consumers and handles markers split across chunks', () => {
  const observer = new CompatReadinessObserver()
  let snapshot: RuntimeSnapshot = {
    mode: 'compat',
    state: 'starting',
    capabilities: [],
  }
  snapshot = observer.observe(snapshot, '[event] ready event_key=im.message.re')
  snapshot = observer.observe(snapshot, 'ceive_v1\n[event] ready event_key=card.action.')
  assert.equal(snapshot.state, 'starting')
  snapshot = observer.observe(snapshot, 'trigger\n', 321)
  assert.deepEqual(snapshot, {
    mode: 'compat',
    state: 'ready',
    pid: 321,
    capabilities: [
      { id: 'channel-event:im.message.receive_v1', required: true, state: 'ready', detail: 'im.message.receive_v1' },
      { id: 'channel-event:card.action.trigger', required: true, state: 'ready', detail: 'card.action.trigger' },
    ],
  })
})

test('includes optional membership and reaction streams in readiness', () => {
  const keys = [
    'im.message.receive_v1', 'card.action.trigger', 'im.chat.member.user.added_v1',
    'im.message.reaction.created_v1', 'im.message.reaction.deleted_v1',
  ]
  const observer = new CompatReadinessObserver(keys)
  let snapshot: RuntimeSnapshot = {
    mode: 'compat', state: 'starting', capabilities: [],
  }
  snapshot = observer.observe(snapshot, keys.slice(0, 4).map((key) => `[event] ready event_key=${key}\n`).join(''))
  assert.equal(snapshot.state, 'starting')
  snapshot = observer.observe(snapshot, `[event] ready event_key=${keys[4]}\n`)
  assert.equal(snapshot.state, 'ready')
  assert.deepEqual(snapshot.capabilities.filter(capability => capability.state === 'ready').map(capability => capability.detail), keys)
})

test('surfaces an unexpected ready child exit so the outer daemon can restart it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-compat-runtime-'))
  const fixture = join(directory, 'fixture.mjs')
  const config = join(directory, 'config.json')
  await writeFile(config, '{}')
  await writeFile(fixture, [
    "process.stderr.write('[event] ready event_key=im.message.receive_v1\\n')",
    "process.stderr.write('[event] ready event_key=card.action.trigger\\n')",
    'setTimeout(() => process.exit(7), 100)',
  ].join('\n'))
  const runtime = new CompatRuntime(config, { entry: fixture, cwd: directory })
  await runtime.start()
  await runtime.waitUntilReady(2_000)
  const failure = await runtime.waitForFailure()
  assert.match(failure.message, /code=7/)
  assert.equal(runtime.snapshot().state, 'failed')
})

test('refuses to start when the compatibility workspace escapes the local allowlist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-compat-boundary-'))
  const allowed = join(directory, 'allowed')
  const outside = join(directory, 'outside')
  await mkdir(allowed)
  await mkdir(outside)
  const config = join(allowed, 'bridge.json')
  await writeFile(config, JSON.stringify({ workspaceRoot: outside }))
  const runtime = new CompatRuntime(config, { workspaceRoots: [allowed] })
  await assert.rejects(runtime.start(), /outside the configured workspace roots/)
  assert.equal(runtime.snapshot().state, 'stopped')
})

test('surfaces aggregated focus-processing failures in compatibility diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-compat-diagnostics-'))
  const varDir = join(directory, 'var')
  const config = join(directory, 'config.json')
  await mkdir(varDir)
  await writeFile(config, JSON.stringify({ varDir, mentionMonitorEnabled: true, mentionPollIntervalMs: 1_800_000 }))
  await writeFile(join(varDir, 'state.json'), JSON.stringify({
    mentionPending: [{ message: { message_id: 'om_pending' } }],
    mentionProcessingFailure: { at: '2026-08-25T00:00:00Z', count: 5, error: '请求超时' },
  }))
  const runtime = new CompatRuntime(config, { cwd: directory })

  const diagnostics = await runtime.diagnostics()
  const focus = diagnostics.monitors.find((monitor) => monitor.id === 'focus')
  assert.equal(focus?.failure, '请求超时')
  assert.equal(focus?.pending, 1)
})

test('surfaces Feishu attention inventory and partial source failures in diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-attention-diagnostics-'))
  const varDir = join(directory, 'var')
  const config = join(directory, 'config.json')
  await mkdir(varDir)
  await writeFile(config, JSON.stringify({ varDir, conversationAttentionEnabled: true, conversationAttentionSyncIntervalMs: 21_600_000 }))
  await writeFile(join(varDir, 'state.json'), JSON.stringify({
    conversationAttentionLastSyncAt: '2026-08-27T02:52:49Z',
    conversationAttentionInventory: { watched: 10, muted: 39 },
    conversationAttentionSourceErrors: [{ source: 'pinned', error: '缺少只读权限' }],
  }))
  const runtime = new CompatRuntime(config, { cwd: directory })

  const diagnostics = await runtime.diagnostics()
  const attention = diagnostics.monitors.find((monitor) => monitor.id === 'attention-signals')
  assert.equal(attention?.pending, 10)
  assert.match(attention?.failure || '', /pinned: 缺少只读权限/)
})
