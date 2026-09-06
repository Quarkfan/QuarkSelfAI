import type { CapabilityArtifactKind, CapabilityManifestV1 } from './manifest.js'

export type CapabilityCandidateBlocker =
  | 'artifact-digest-missing'
  | 'license-decision-missing'
  | 'lifecycle-contract-missing'
  | 'permission-review-missing'
  | 'sbom-missing'
  | 'signature-missing'
  | 'private-manifest-required'

export interface CapabilityArtifactCandidateSpecV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly kind: CapabilityArtifactKind
  readonly targetPlane: 'local' | 'cloud' | 'hybrid' | 'governance' | 'private-pack'
  readonly moduleIds: readonly string[]
  readonly offerSelector: 'explicit-modules' | 'all-private-pack-offers'
  readonly blockers: readonly CapabilityCandidateBlocker[]
  readonly activationAllowed: false
  readonly publicationAllowed: false
}

export interface CompiledCapabilityArtifactCandidateV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly kind: CapabilityArtifactKind
  readonly targetPlane: CapabilityArtifactCandidateSpecV1['targetPlane']
  /** Public candidates expose their module coverage. Private candidates expose only a count and digest. */
  readonly moduleIds: readonly string[]
  readonly coveredModuleCount: number
  readonly coveredModuleDigest: string
  readonly blockers: readonly CapabilityCandidateBlocker[]
  readonly manifestStatus: 'evidence-pending'
  readonly activationAllowed: false
  readonly publicationAllowed: false
  readonly currentOwnerPreserved: true
}

export interface CapabilityArtifactCandidateCatalogV1 {
  readonly schemaVersion: 1
  readonly sourceRevision: string
  readonly candidates: readonly CompiledCapabilityArtifactCandidateV1[]
  readonly eligibleOfferCount: number
  readonly coveredOfferCount: number
  readonly uncoveredModuleIds: readonly string[]
}

export interface ManifestPublicationCandidateV1 {
  readonly schemaVersion: 1
  readonly candidateId: string
  readonly manifest: CapabilityManifestV1
  readonly manifestDigest: string
  readonly evidencePolicyRevision: string
  readonly status: 'validated-unpublished'
  readonly publicationAllowed: false
  readonly activationAllowed: false
  readonly currentOwnerPreserved: true
}
