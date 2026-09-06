import type { DeviceTransportPolicyV1, InactiveTransportSelectionV1 } from './device-transport.js'

const opaqueRef = /^(?:endpoint|identity|secret):[a-z0-9][a-z0-9._-]{0,127}$/

/** Validates configuration only. It cannot spawn ssh, open a socket or acquire a device lease. */
export function defineDeviceTransportPolicy(value: DeviceTransportPolicyV1): DeviceTransportPolicyV1 {
  if (value.schemaVersion !== 1 || value.protocol !== 'quark-device-sync.v1') throw new Error('device transport policy is unsupported')
  if (JSON.stringify(value.preference) !== JSON.stringify(['direct-tls', 'ssh-subsystem'])) throw new Error('direct TLS must remain the primary transport')
  if (!opaqueRef.test(value.directEndpointRef) || !opaqueRef.test(value.ssh.endpointRef) || !opaqueRef.test(value.ssh.userRef) || !opaqueRef.test(value.ssh.credentialRef) || !opaqueRef.test(value.ssh.hostKeyFingerprintRef)) throw new Error('transport endpoints and identities must use opaque references')
  if (value.ssh.kind !== 'ssh-subsystem' || value.ssh.state !== 'configured-inactive' || value.ssh.subsystem !== 'quark-device-v1' || value.ssh.hostKeyVerification !== 'pinned') throw new Error('SSH fallback identity or host-key pin is invalid')
  if (!value.ssh.clientInitiated || !value.ssh.fallbackOnly || value.ssh.remoteShellAllowed || value.ssh.remoteCommandAllowed || value.ssh.portForwardingAllowed || value.ssh.agentForwardingAllowed) throw new Error('SSH fallback must be outbound and subsystem-only')
  if (!value.singleActiveTransport || !value.resumeSameDeviceSession || !value.preservePlanLeaseAndIdempotency || value.activationAllowed) throw new Error('transport ownership and execution safety gates are invalid')
  return deepFreeze(structuredClone(value))
}

export function planInactiveTransportSelection(policyInput: DeviceTransportPolicyV1, directConnectivity: 'available' | 'unavailable'): InactiveTransportSelectionV1 {
  const policy = defineDeviceTransportPolicy(policyInput)
  return deepFreeze({
    schemaVersion: 1,
    selected: directConnectivity === 'available' ? 'direct-tls' : policy.ssh.kind,
    reason: directConnectivity === 'available' ? 'direct-primary' : 'ssh-fallback-candidate',
    state: 'inactive-plan',
    previousTransportMustReleaseLease: true,
    listenerStarted: false,
    sshProcessStarted: false,
    activationAllowed: false,
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
