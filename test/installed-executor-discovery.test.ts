import assert from 'node:assert/strict'
import test from 'node:test'
import { NodeInstalledExecutorDiscoveryV1 } from '../src/client-runtime/installed-executor-discovery.js'

const now = new Date('2026-09-06T00:00:00.000Z')

test('discovers Claude Code, Codex and bundled DSH through one privacy-bounded provider', async () => {
  const versionRunner = { async run(executorId: 'claude-code' | 'codex' | 'dsh') { return { state: 'completed' as const, exitCode: 0, output: `${executorId} 1.2.3 at /Users/private/bin`, authentication: 'unknown' as const } } }
  const authRunner = { async run(executorId: 'claude-code' | 'codex') { return { state: 'completed' as const, exitCode: 0, output: executorId === 'claude-code' ? JSON.stringify({ loggedIn: true, account: 'private@example.com' }) : 'Not logged in' } } }
  const discovery = new NodeInstalledExecutorDiscoveryV1('/tmp/workspace', {
    versionRunner,
    authRunner,
    runtimeRoot: '/tmp/runtime',
    bundledDshDiscovery: async root => {
      assert.equal(root, '/tmp/runtime')
      return { schemaVersion: 1, executorId: 'dsh', installation: 'detected', version: '0.0.11', inferenceConfigured: true, authentication: 'ready', protocolVersions: ['envelope.v1'], capabilities: ['agent.execute', 'tool.execute'] }
    },
  })

  const reports = await discovery.inspect('device.owner', now)
  assert.deepEqual(reports.map(item => [item.executorId, item.availability]), [['claude-code', 'ready'], ['codex', 'auth-required'], ['dsh', 'ready']])
  assert.equal(JSON.stringify(reports).includes('/Users/private'), false)
  assert.equal(JSON.stringify(reports).includes('private@example.com'), false)
  assert.equal(JSON.stringify(reports).includes('Not logged in'), false)
  assert.deepEqual(reports[2]?.constraints, ['local-only', 'bundled-fallback', 'no-mid-action-switch'])
})

test('isolates probe failures and never treats partial DSH closure as a ready fallback', async () => {
  const discovery = new NodeInstalledExecutorDiscoveryV1('/tmp/workspace', {
    versionRunner: { async run(executorId) { if (executorId === 'claude-code') throw new Error('private failure detail'); return { state: 'not-found' as const, exitCode: null, output: '', authentication: 'unknown' as const } } },
    authRunner: { async run() { throw new Error('must not be called when executable is absent') } },
    runtimeRoot: '/tmp/runtime',
    bundledDshDiscovery: async () => ({ schemaVersion: 1, executorId: 'dsh', installation: 'package-drift', version: null, inferenceConfigured: true, authentication: 'required', protocolVersions: [], capabilities: [] }),
  })
  const reports = await discovery.inspect('device.owner', now)
  assert.deepEqual(reports.map(item => [item.executorId, item.availability]), [['claude-code', 'unavailable'], ['codex', 'not-installed'], ['dsh', 'unavailable']])
})

test('requires an explicit canonical absolute workspace and runtime root', () => {
  assert.throws(() => new NodeInstalledExecutorDiscoveryV1('relative'), /exact absolute path/)
  assert.throws(() => new NodeInstalledExecutorDiscoveryV1('/tmp/../tmp/workspace'), /exact absolute path/)
  assert.throws(() => new NodeInstalledExecutorDiscoveryV1('/tmp/workspace', { runtimeRoot: 'relative' }), /exact absolute path/)
})
