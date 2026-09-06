import type { ExecutionEnvelopeV1 } from '../capability-platform/execution-envelope.js'

export type ClientConnectionState = 'unenrolled' | 'disconnected' | 'connecting' | 'online' | 'degraded' | 'revoked'
export type ExecutorAvailability = 'ready' | 'not-installed' | 'auth-required' | 'version-unsupported' | 'unavailable'

/** Public device identity. Private keys and host paths are deliberately absent. */
export interface DeviceIdentityV1 {
  readonly schemaVersion: 1
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly publicKey: string
  readonly keyAlgorithm: 'ed25519'
  readonly createdAt: string
  readonly attestation: { readonly kind: 'self' | 'platform'; readonly reference: string }
}

/** Privacy-bounded discovery output. Executable paths, command output and auth material are forbidden. */
export interface ExecutorCapabilityReportV1 {
  readonly schemaVersion: 1
  readonly deviceId: string
  readonly executorId: string
  readonly availability: ExecutorAvailability
  readonly version: string | null
  readonly protocolVersions: readonly string[]
  readonly capabilities: readonly string[]
  readonly constraints: readonly string[]
  readonly discoveredAt: string
  readonly expiresAt: string
}

export interface ExecutorRequirementV1 {
  readonly protocolVersions: readonly string[]
  readonly capabilities: readonly string[]
  readonly allowedExecutors: readonly string[]
  readonly preferredExecutors: readonly string[]
}

export interface ExecutorSelectionV1 {
  readonly executorId: string
  readonly reportExpiresAt: string
  readonly matchedProtocolVersion: string
  readonly matchedCapabilities: readonly string[]
  readonly reason: 'preferred-ready' | 'fallback-ready'
}

export interface SignedExecutionPlanV1 {
  readonly schemaVersion: 1
  readonly planId: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly keyId: string
  readonly algorithm: 'ed25519'
  readonly payloadDigest: string
  readonly signature: string
  readonly envelope: ExecutionEnvelopeV1
}

export interface ClientRuntimeSnapshotV1 {
  readonly deviceId: string | null
  readonly connection: ClientConnectionState
  readonly registeredCapabilities: 0
  readonly activeCapabilities: 0
  readonly ownedConsumers: 0
  readonly ownedProviders: 0
  readonly ownedSchedulers: 0
  readonly externalWritesEnabled: false
}

export type ArtifactVerificationCheck = 'license' | 'signature' | 'sbom' | 'malware' | 'maintenance' | 'dependencies'

export interface ArtifactVerificationReportV1 {
  readonly schemaVersion: 1
  readonly capabilityId: string
  readonly version: string
  readonly artifactDigest: string
  readonly sourceRevision: string
  readonly policyRevision: string
  readonly checks: Readonly<Record<ArtifactVerificationCheck, 'pass' | 'warn' | 'fail'>>
  readonly decision: 'verified' | 'rejected'
  readonly evaluatedAt: string
}

export interface InactiveInstallationPlanV1 {
  readonly schemaVersion: 1
  readonly planId: string
  readonly deviceId: string
  readonly capabilityId: string
  readonly version: string
  readonly artifactDigest: string
  readonly isolation: string
  readonly lifecycleHandler: string
  readonly requiredApproval: 'install'
  readonly targetState: 'installed-inactive'
  readonly loadAllowed: false
  readonly runAllowed: false
  readonly externalWritesEnabled: false
  readonly createdAt: string
}

/** Local-only version pointer. Selection never implies loading, authorization or execution. */
export interface InactiveCapabilitySelectionV1 {
  readonly capabilityId: string
  readonly currentVersion: string
  readonly previousVersion: string | null
  readonly updatedAt: string
}

export interface ExecutorDiscoveryProbeV1 {
  readonly executorId: string
  inspect(deviceId: string, now: Date): Promise<ExecutorCapabilityReportV1>
}

export interface PlanSignatureVerifierV1 {
  verify(input: { readonly keyId: string; readonly algorithm: 'ed25519'; readonly payloadDigest: string; readonly signature: string }): Promise<boolean>
}

export interface DeviceSessionChallengeV1 {
  readonly schemaVersion: 1
  readonly challengeId: string
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly nonce: string
  readonly issuedAt: string
  readonly expiresAt: string
}

export interface DeviceSessionProofV1 {
  readonly schemaVersion: 1
  readonly challengeId: string
  readonly deviceId: string
  readonly keyId: string
  readonly algorithm: 'ed25519'
  readonly signature: string
}

export interface DeviceSessionV1 {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly state: 'active' | 'superseded' | 'expired' | 'revoked'
}

export interface DeviceTaskLeaseV1 {
  readonly schemaVersion: 1
  readonly taskId: string
  readonly planId: string
  readonly plan: SignedExecutionPlanV1
  readonly deviceId: string
  readonly leaseToken: string
  readonly attempt: number
  readonly leasedAt: string
  readonly expiresAt: string
  readonly externalWritesEnabled: false
}

export interface DeviceTaskLeaseAcknowledgementV1 {
  readonly schemaVersion: 1
  readonly taskId: string
  readonly planId: string
  readonly deviceId: string
  readonly state: 'accepted'
  readonly acceptedAt: string
}

export interface DeviceProofVerifierV1 {
  verify(input: { readonly publicKey: string; readonly algorithm: 'ed25519'; readonly challenge: string; readonly signature: string }): Promise<boolean>
}
