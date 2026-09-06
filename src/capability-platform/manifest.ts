import type { CapabilityInterfaceV1 } from './interfaces.js'
import type { CapabilityPermissionDeclarationV1, CapabilityPlacement } from './permissions.js'

export type CapabilityArtifactKind =
  | 'skill'
  | 'knowledge'
  | 'policy'
  | 'workflow'
  | 'connector'
  | 'package'
  | 'sdk'
  | 'cli'
  | 'binary'
  | 'project'
  | 'browser-runtime'
  | 'container'
  | 'notebook'
  | 'sandbox'
  | 'application'
  | 'game'
  | 'simulation'
  | 'integration-pack'
  | 'agent'
  | 'composite'

export type CapabilityLifecycleState = 'catalogued' | 'verified' | 'installed' | 'loaded' | 'authorized' | 'active' | 'stopped' | 'retired'

export interface CapabilitySourceV1 {
  readonly kind: 'git' | 'registry' | 'local-build' | 'first-party'
  readonly locator: string
  readonly revision: string
  readonly artifactDigest: string
  readonly license: string
  readonly supplier: string
  readonly signature: { readonly status: 'verified' | 'missing' | 'invalid'; readonly keyId?: string }
  readonly sbom: { readonly format: 'spdx' | 'cyclonedx' | 'none'; readonly digest?: string }
}

export interface CapabilityDependencyV1 {
  readonly id: string
  readonly versionRange: string
  readonly required: boolean
  readonly placement?: CapabilityPlacement
}

export interface CapabilityRuntimeV1 {
  readonly placements: readonly CapabilityPlacement[]
  readonly isolation: 'pure' | 'process' | 'container' | 'browser-profile' | 'vm' | 'remote-service'
  readonly supportedPlatforms: readonly string[]
  readonly executorRequirements: readonly string[]
  readonly stateNamespace: string
  readonly offlineCapable: boolean
}

export interface CapabilityRecoveryV1 {
  readonly strategy: 'stateless' | 'reinstall' | 'snapshot' | 'encrypted-state'
  readonly rollbackVersion: string | null
  readonly stateIncluded: boolean
  readonly restoreEffectsEnabled: false
}

export interface CapabilityTestDeclarationV1 {
  readonly id: string
  readonly kind: 'contract' | 'fixture' | 'redacted-replay' | 'health' | 'shadow'
  readonly required: boolean
  readonly effectMode: 'none' | 'recording-sink'
}

export interface CapabilityManifestV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly version: string
  readonly kind: CapabilityArtifactKind
  readonly description: string
  readonly source: CapabilitySourceV1
  readonly runtime: CapabilityRuntimeV1
  readonly interfaces: readonly CapabilityInterfaceV1[]
  readonly dependencies: readonly CapabilityDependencyV1[]
  readonly permissions: readonly CapabilityPermissionDeclarationV1[]
  readonly dataClasses: readonly string[]
  readonly tests: readonly CapabilityTestDeclarationV1[]
  readonly recovery: CapabilityRecoveryV1
}

export interface CapabilityInstallationStateV1 {
  readonly capabilityId: string
  readonly version: string
  readonly artifactDigest: string
  readonly state: CapabilityLifecycleState
  readonly deviceId: string | null
  readonly updatedAt: string
  readonly activeOwnerLease: null
  readonly externalWritesEnabled: false
}

