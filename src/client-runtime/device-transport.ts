export type DeviceTransportKindV1 = 'direct-tls' | 'ssh-subsystem'

export interface SshSubsystemTransportV1 {
  readonly kind: 'ssh-subsystem'
  readonly state: 'configured-inactive'
  readonly endpointRef: string
  readonly userRef: string
  readonly credentialRef: string
  readonly hostKeyFingerprintRef: string
  readonly hostKeyVerification: 'pinned'
  readonly subsystem: 'quark-device-v1'
  readonly clientInitiated: true
  readonly fallbackOnly: true
  readonly remoteShellAllowed: false
  readonly remoteCommandAllowed: false
  readonly portForwardingAllowed: false
  readonly agentForwardingAllowed: false
}

export interface DeviceTransportPolicyV1 {
  readonly schemaVersion: 1
  readonly protocol: 'quark-device-sync.v1'
  readonly preference: readonly ['direct-tls', 'ssh-subsystem']
  readonly directEndpointRef: string
  readonly ssh: SshSubsystemTransportV1
  readonly singleActiveTransport: true
  readonly resumeSameDeviceSession: true
  readonly preservePlanLeaseAndIdempotency: true
  readonly activationAllowed: false
}

export interface InactiveTransportSelectionV1 {
  readonly schemaVersion: 1
  readonly selected: DeviceTransportKindV1
  readonly reason: 'direct-primary' | 'ssh-fallback-candidate'
  readonly state: 'inactive-plan'
  readonly previousTransportMustReleaseLease: true
  readonly listenerStarted: false
  readonly sshProcessStarted: false
  readonly activationAllowed: false
}
