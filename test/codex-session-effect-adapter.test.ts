import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CodexSessionEffectAdapter,
  codexThreadActivity,
  type CodexSessionCommandRunner,
  type CodexSessionActivityProbe,
  type CodexSessionReader,
  type CodexSessionSnapshot,
} from '../src/session-lifecycle/codex-effect-plugin.js'
import type { ClaimedWorkflowEffect } from '../src/storage/types.js'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const authorization = {
  id: 'owner-policy:session:v1', grantedBy: 'owner', grantedAt: '2026-08-01T00:00:00Z',
  scope: 'codex.auto-research-session-lifecycle', revision: 1, source: 'owner-directive:test', minimumArchivedDays: 7,
}

class Reader implements CodexSessionReader {
  state: CodexSessionSnapshot = { exists: true, archived: false }
  inspect() { return this.state }
}

class Runner implements CodexSessionCommandRunner {
  readonly calls: Array<{ executable: string; args: readonly string[]; cwd: string }> = []
  constructor(private readonly reader: Reader) {}
  async run(executable: string, args: readonly string[], cwd: string) {
    this.calls.push({ executable, args, cwd })
    if (args[0] === 'archive') this.reader.state = { exists: true, archived: true, archivedAt: '2026-08-02T00:00:00Z' }
    if (args[0] === 'delete') this.reader.state = { exists: false, archived: false }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

function effect(kind: string, payload: Readonly<Record<string, unknown>>): ClaimedWorkflowEffect {
  return { id: `effect:${kind}`, instanceId: 'workflow:1', kind, payload, attempt: 1 }
}

function adapter(reader = new Reader()) {
  const runner = new Runner(reader)
  const activity: CodexSessionActivityProbe = { running: () => false }
  return { reader, runner, adapter: new CodexSessionEffectAdapter({ executable: 'codex-next', stateDatabase: '/fixture/state.sqlite', workspace: '/fixture/workspace' }, reader, runner, activity) }
}

test('inspects an exact session through the injected activity probe', async () => {
  const harness = adapter()
  assert.deepEqual(await harness.adapter.execute(effect('codex-session.inspect.v1', { sessionId })), {
    exists: true, archived: false, running: false,
  })
  assert.equal(harness.runner.calls.length, 0)
  await assert.rejects(harness.adapter.execute(effect('codex-session.inspect.v1', { sessionId: 'latest' })), /exact UUID/)
})

test('maps only authoritative app-server thread states to lifecycle activity', () => {
  assert.equal(codexThreadActivity({ thread: { status: { type: 'active', activeFlags: [] } } }), true)
  assert.equal(codexThreadActivity({ thread: { status: { type: 'idle' } } }), false)
  assert.equal(codexThreadActivity({ thread: { status: { type: 'notLoaded' } } }), 'unknown')
  assert.equal(codexThreadActivity({ thread: { status: { type: 'systemError' } } }), 'unknown')
  assert.equal(codexThreadActivity({ thread: {} }), 'unknown')
})

test('awaits an asynchronous host activity probe before inspecting or mutating', async () => {
  const reader = new Reader()
  const runner = new Runner(reader)
  const activity: CodexSessionActivityProbe = { running: async () => false }
  const adapter = new CodexSessionEffectAdapter(
    { stateDatabase: '/fixture/state.sqlite', workspace: '/fixture/workspace' }, reader, runner, activity,
  )
  assert.equal((await adapter.execute(effect('codex-session.inspect.v1', { sessionId }))).running, false)
  await adapter.execute(effect('codex-session.archive-if-needed.v1', {
    sessionId, managedBy: 'quarkselfai-auto-research', effectiveAt: '2026-08-24T00:00:00Z', authorization,
  }))
  assert.equal(runner.calls.length, 1)
})

test('mutating effects fail closed when session activity is not authoritative', async () => {
  const reader = new Reader()
  const runner = new Runner(reader)
  const adapter = new CodexSessionEffectAdapter(
    { stateDatabase: '/fixture/state.sqlite', workspace: '/fixture/workspace' }, reader, runner,
  )
  await assert.rejects(adapter.execute(effect('codex-session.archive-if-needed.v1', {
    sessionId, managedBy: 'quarkselfai-auto-research', effectiveAt: '2026-08-24T00:00:00Z', authorization,
  })), /not confirmed idle/)
  assert.equal(runner.calls.length, 0)
})

test('archives with exact authorization and confirms the durable Codex state', async () => {
  const harness = adapter()
  const output = await harness.adapter.execute(effect('codex-session.archive-if-needed.v1', {
    sessionId, managedBy: 'quarkselfai-auto-research', effectiveAt: '2026-08-24T00:00:00Z', authorization,
  }))
  assert.deepEqual(output, { archivedAt: '2026-08-02T00:00:00Z', alreadyArchived: false, authorizationId: authorization.id })
  assert.deepEqual(harness.runner.calls[0], { executable: 'codex-next', args: ['archive', sessionId], cwd: '/fixture/workspace' })
})

test('deletes only archived managed sessions after retention and always uses force plus UUID', async () => {
  const harness = adapter()
  harness.reader.state = { exists: true, archived: true, archivedAt: '2026-08-01T00:00:00Z' }
  const output = await harness.adapter.execute(effect('codex-session.delete-if-archived.v1', {
    sessionId, managedBy: 'quarkselfai-auto-research', archivedAt: '2026-08-01T00:00:00Z',
    effectiveAt: '2026-08-08T00:00:00Z', authorization,
  }))
  assert.deepEqual(output, { outcome: 'deleted', authorizationId: authorization.id })
  assert.deepEqual(harness.runner.calls[0]!.args, ['delete', '--force', sessionId])
})

test('session deletion fails closed before running Codex when scope is unsafe', async () => {
  const harness = adapter()
  harness.reader.state = { exists: true, archived: true }
  await assert.rejects(harness.adapter.execute(effect('codex-session.delete-if-archived.v1', {
    sessionId, managedBy: 'quarkselfai-auto-research', archivedAt: '2026-08-02T00:00:00Z',
    effectiveAt: '2026-08-08T00:00:00Z', authorization,
  })), /retention period/)
  assert.equal(harness.runner.calls.length, 0)
  await assert.rejects(harness.adapter.execute(effect('codex-session.delete-if-archived.v1', {
    sessionId, managedBy: 'other', archivedAt: '2026-08-01T00:00:00Z', effectiveAt: '2026-08-08T00:00:00Z', authorization,
  })), /not owned/)
  assert.equal(harness.runner.calls.length, 0)
})

test('manual unarchive and already missing sessions are safe no-ops', async () => {
  const harness = adapter()
  harness.reader.state = { exists: true, archived: false }
  const payload = { sessionId, managedBy: 'quarkselfai-auto-research', archivedAt: '2026-08-01T00:00:00Z', effectiveAt: '2026-08-08T00:00:00Z', authorization }
  assert.deepEqual(await harness.adapter.execute(effect('codex-session.delete-if-archived.v1', payload)), { outcome: 'not-archived', authorizationId: authorization.id })
  harness.reader.state = { exists: false, archived: false }
  assert.deepEqual(await harness.adapter.execute(effect('codex-session.delete-if-archived.v1', payload)), { outcome: 'missing', authorizationId: authorization.id })
  assert.equal(harness.runner.calls.length, 0)
})
