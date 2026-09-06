import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareSshGatewayInstallPlanV1 } from '../src/control-plane/ssh-gateway-install-plan.js'

const keyBlob = Buffer.alloc(51); keyBlob.writeUInt32BE(11, 0); keyBlob.write('ssh-ed25519', 4, 'ascii'); keyBlob.writeUInt32BE(32, 15); Buffer.alloc(32, 7).copy(keyBlob, 19)
const publicKey = `ssh-ed25519 ${keyBlob.toString('base64')} device-test`
const input = { osUser: 'quark_device', nodeExecutable: '/usr/bin/node', subsystemEntry: '/opt/quark/server/ssh-subsystem-entry.js', subsystemConfig: '/var/lib/quark/ssh.json', authorizedPublicKey: publicKey, sshdDropInPath: '/etc/ssh/sshd_config.d/90-quark-device.conf', authorizedKeysPath: '/var/lib/quark/.ssh/authorized_keys' }

test('renders a content-addressed public-key-only forced-command SSH gateway plan', () => {
  const plan = prepareSshGatewayInstallPlanV1(input)
  assert.match(plan.planDigest, /^sha256:[a-f0-9]{64}$/); assert.equal(plan.requiredOpenSsh, '>=7.2'); assert.equal(plan.state, 'prepared-inactive'); assert.equal(plan.applyAllowed, false); assert.equal(plan.reloadAllowed, false)
  assert.match(plan.authorizedKeyLine, /^restrict,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,command="QUARK_SSH_SUBSYSTEM_ENABLE=1 \/usr\/bin\/node /)
  for (const directive of ['AuthenticationMethods publickey', 'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'AllowTcpForwarding no', 'AllowAgentForwarding no', 'X11Forwarding no', 'PermitTTY no', 'PermitTunnel no']) assert.match(plan.sshdMatchBlock, new RegExp(directive))
  assert.equal(JSON.stringify(plan).includes('PRIVATE KEY'), false); assert.equal(Object.isFrozen(plan.rollback), true)
})

test('rejects root, key options, multiline keys and shell-ambiguous paths', () => {
  assert.throws(() => prepareSshGatewayInstallPlanV1({ ...input, osUser: 'root' }), /OS user/)
  assert.throws(() => prepareSshGatewayInstallPlanV1({ ...input, authorizedPublicKey: `command="id" ${publicKey}` }), /public key/)
  assert.throws(() => prepareSshGatewayInstallPlanV1({ ...input, authorizedPublicKey: `${publicKey}\nssh-ed25519 AAAA second` }), /public key/)
  assert.throws(() => prepareSshGatewayInstallPlanV1({ ...input, subsystemConfig: '/var/lib/quark/ssh config.json' }), /shell-safe/)
})
