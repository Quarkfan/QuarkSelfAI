import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { DeviceTransportPolicyV1 } from '../src/client-runtime/device-transport.js'
import { inspectSshClient, prepareInactiveSshSubsystemLaunch } from '../src/client-runtime/ssh-subsystem-process.js'

const policy = async () => JSON.parse(await readFile(new URL('../config/device-transport-policy.json', import.meta.url), 'utf8')) as DeviceTransportPolicyV1
const resolved = { endpointRef: 'endpoint:ssh-gateway', host: 'gateway.example.com', port: 22, userRef: 'identity:device-tunnel', user: 'quark_device', credentialRef: 'secret:ssh-device-key', identityFile: '/private/local/device-key', hostKeyFingerprintRef: 'identity:ssh-host-key', knownHostsFile: '/private/local/known-hosts' }

test('prepares only a pinned subsystem process with every forwarding and shell path disabled', async () => {
  const launch = prepareInactiveSshSubsystemLaunch(await policy(), resolved)
  assert.equal(launch.processStarted, false); assert.equal(launch.activationAllowed, false); assert.equal(launch.shell, false)
  assert.deepEqual(launch.args.slice(-3), ['-s', 'quark_device@gateway.example.com', 'quark-device-v1'])
  for (const flag of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ForwardAgent=no', 'ClearAllForwardings=yes', 'PermitLocalCommand=no', 'RequestTTY=no']) assert.ok(launch.args.includes(flag))
  assert.equal(launch.args.some(value => /ProxyCommand|accept-new/i.test(value)), false)
})

test('rejects reference drift, unsafe endpoints and non-absolute local credential files', async () => {
  const value = await policy()
  assert.throws(() => prepareInactiveSshSubsystemLaunch(value, { ...resolved, credentialRef: 'secret:other' }), /do not match/)
  assert.throws(() => prepareInactiveSshSubsystemLaunch(value, { ...resolved, host: '-oProxyCommand=evil' }), /endpoint is invalid/)
  assert.throws(() => prepareInactiveSshSubsystemLaunch(value, { ...resolved, identityFile: 'relative/key' }), /absolute local paths/)
})

test('classifies a fixed local SSH version probe without retaining raw output', async () => {
  const report = await inspectSshClient(new Date('2026-09-06T00:00:00.000Z'), { run: async () => ({ state: 'completed', output: 'OpenSSH_9.9p1 test-build secret=no' }) })
  assert.deepEqual(report, { schemaVersion: 1, installation: 'detected', version: '9.9p1', checkedAt: '2026-09-06T00:00:00.000Z', rawOutputRetained: false })
})
