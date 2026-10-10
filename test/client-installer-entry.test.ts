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
  assert.deepEqual(compileClientInstallerCommand(['provision-master-key', '/opt/quark-client']), { mode: 'provision-master-key', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['provision-dsh-secret', '/opt/quark-client']), { mode: 'provision-dsh-secret', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['dsh-secret-status', '/opt/quark-client']), { mode: 'dsh-secret-status', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['remove-dsh-secret', '/opt/quark-client']), { mode: 'remove-dsh-secret', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['begin-enrollment', '/opt/quark-client']), { mode: 'begin-enrollment', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['poll-enrollment', '/opt/quark-client']), { mode: 'poll-enrollment', installRoot: '/opt/quark-client' })
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
  await assert.rejects(runClientInstallerEntry(['provision-master-key', '/opt/quark-client'], {}), /disabled/)
  await assert.rejects(runClientInstallerEntry(['provision-dsh-secret', '/opt/quark-client'], {}), /disabled/)
  await assert.rejects(runClientInstallerEntry(['remove-dsh-secret', '/opt/quark-client'], {}), /disabled/)
  await assert.rejects(runClientInstallerEntry(['begin-enrollment', '/opt/quark-client'], { QUARK_CLIENT_ADMIN_ENABLE: '1' }), /enrollment commands are disabled/)
  await assert.rejects(runClientInstallerEntry(['poll-enrollment', '/opt/quark-client'], { QUARK_CLIENT_ADMIN_ENABLE: '1' }), /enrollment commands are disabled/)
})
