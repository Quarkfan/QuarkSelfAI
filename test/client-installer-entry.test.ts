import assert from 'node:assert/strict'
import test from 'node:test'
import { compileClientInstallerCommand } from '../src/client-runtime/client-installer-entry.js'

test('accepts only closed absolute-path installer commands', () => {
  assert.deepEqual(compileClientInstallerCommand(['install', '/tmp/distribution', '/opt/quark-client', '/tmp/client.json']), { mode: 'install', distributionRoot: '/tmp/distribution', installRoot: '/opt/quark-client', configPath: '/tmp/client.json' })
  assert.deepEqual(compileClientInstallerCommand(['status', '/opt/quark-client']), { mode: 'status', installRoot: '/opt/quark-client' })
  assert.deepEqual(compileClientInstallerCommand(['uninstall-unused', '/opt/quark-client']), { mode: 'uninstall-unused', installRoot: '/opt/quark-client' })
  assert.throws(() => compileClientInstallerCommand(['install', 'relative', '/opt/quark-client', '/tmp/client.json']), /absolute/)
  assert.throws(() => compileClientInstallerCommand(['remove', '/opt/quark-client']), /invalid/)
  assert.throws(() => compileClientInstallerCommand(['status', '/']), /absolute/)
})
