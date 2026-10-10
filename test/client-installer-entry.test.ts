import assert from 'node:assert/strict'
import test from 'node:test'
import { compileClientInstallerCommand, runClientInstallerEntry } from '../src/client-runtime/client-installer-entry.js'

test('accepts only closed absolute-path installer commands', () => {
  assert.deepEqual(compileClientInstallerCommand(['install', '/tmp/distribution', '/opt/quark-client', '/tmp/client.json']), { mode: 'install', distributionRoot: '/tmp/distribution', installRoot: '/opt/quark-client', configPath: '/tmp/client.json' })
  assert.deepEqual(compileClientInstallerCommand(['status', '/opt/quark-client']), { mode: 'status', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['prepare-service', '/opt/quark-client', '/tmp/service.json']), { mode: 'prepare-service', installRoot: '/opt/quark-client', configPath: '/tmp/service.json' })
  assert.deepEqual(compileClientInstallerCommand(['service-status', '/opt/quark-client']), { mode: 'service-status', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['activate-service', '/opt/quark-client', '/tmp/activation.json']), { mode: 'activate-service', installRoot: '/opt/quark-client', configPath: '/tmp/activation.json' })
  assert.deepEqual(compileClientInstallerCommand(['reconcile-service', '/opt/quark-client', '/tmp/activation.json']), { mode: 'reconcile-service', installRoot: '/opt/quark-client', configPath: '/tmp/activation.json' })
  assert.deepEqual(compileClientInstallerCommand(['activation-status', '/opt/quark-client']), { mode: 'activation-status', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['deactivate-service', '/opt/quark-client']), { mode: 'deactivate-service', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['remove-unregistered-service', '/opt/quark-client']), { mode: 'remove-unregistered-service', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['uninstall-unused', '/opt/quark-client']), { mode: 'uninstall-unused', installRoot: '/opt/quark-client' })
  assert.throws(() => compileClientInstallerCommand(['install', 'relative', '/opt/quark-client', '/tmp/client.json']), /absolute/)
  assert.throws(() => compileClientInstallerCommand(['remove', '/opt/quark-client']), /invalid/)
  assert.throws(() => compileClientInstallerCommand(['status', '/']), /absolute/)
})

test('keeps every service-manager mutation behind an exact local admin gate', async () => {
  await assert.rejects(runClientInstallerEntry(['activate-service', '/opt/quark-client', '/tmp/activation.json'], {}), /disabled/)
  await assert.rejects(runClientInstallerEntry(['reconcile-service', '/opt/quark-client', '/tmp/activation.json'], {}), /disabled/)
  await assert.rejects(runClientInstallerEntry(['deactivate-service', '/opt/quark-client'], {}), /disabled/)
})
