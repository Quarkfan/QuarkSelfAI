import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { DeviceTransportPolicyV1 } from '../src/client-runtime/device-transport.js'
import { defineDeviceTransportPolicy, planInactiveTransportSelection } from '../src/client-runtime/ssh-transport-policy.js'

async function policy(): Promise<DeviceTransportPolicyV1> {
  return JSON.parse(await readFile(new URL('../config/device-transport-policy.json', import.meta.url), 'utf8')) as DeviceTransportPolicyV1
}

test('keeps direct TLS primary and SSH as one inactive subsystem-only fallback', async () => {
  const value = defineDeviceTransportPolicy(await policy())
  assert.deepEqual(planInactiveTransportSelection(value, 'available'), {
    schemaVersion: 1, selected: 'direct-tls', reason: 'direct-primary', state: 'inactive-plan', previousTransportMustReleaseLease: true,
    listenerStarted: false, sshProcessStarted: false, activationAllowed: false,
  })
  assert.equal(planInactiveTransportSelection(value, 'unavailable').selected, 'ssh-subsystem')
  assert.equal(value.ssh.remoteShellAllowed, false)
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.ssh))
})

test('rejects unpinned, effect-expanding or dual-owner SSH configuration', async () => {
  const value = await policy()
  assert.throws(() => defineDeviceTransportPolicy({ ...value, ssh: { ...value.ssh, hostKeyVerification: 'accept-new' as 'pinned' } }), /host-key pin/)
  assert.throws(() => defineDeviceTransportPolicy({ ...value, ssh: { ...value.ssh, remoteShellAllowed: true } }), /subsystem-only/)
  assert.throws(() => defineDeviceTransportPolicy({ ...value, preference: ['ssh-subsystem', 'direct-tls'] }), /primary transport/)
  assert.throws(() => defineDeviceTransportPolicy({ ...value, singleActiveTransport: false }), /ownership/)
})
