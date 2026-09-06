import type { ArtifactVerificationReportV1 } from '../client-runtime/contracts.js'
import type { CompiledCapabilityArtifactCandidateV1, ManifestPublicationCandidateV1 } from './artifact-candidates.js'
import { contentDigest, validateCapabilityManifest } from './validation.js'

const requiredChecks = ['license', 'signature', 'sbom', 'malware', 'maintenance', 'dependencies'] as const

/** Produces reviewable metadata only. Publishing remains an independent owner-authorized operation. */
export function prepareManifestPublicationCandidate(
  candidate: CompiledCapabilityArtifactCandidateV1,
  manifestInput: unknown,
  evidence: ArtifactVerificationReportV1,
): ManifestPublicationCandidateV1 {
  if (candidate.manifestStatus !== 'evidence-pending' || candidate.publicationAllowed || candidate.activationAllowed || !candidate.currentOwnerPreserved) {
    throw new Error('capability candidate is not safe for evidence resolution')
  }
  if (candidate.targetPlane === 'private-pack' || candidate.kind === 'integration-pack' || candidate.blockers.includes('private-manifest-required')) {
    throw new Error('private integration manifests must be prepared inside the private pack')
  }
  const manifest = validateCapabilityManifest(manifestInput)
  if (manifest.id !== candidate.id || manifest.kind !== candidate.kind) throw new Error('manifest identity does not match capability candidate')
  if (evidence.schemaVersion !== 1 || evidence.capabilityId !== manifest.id || evidence.version !== manifest.version || evidence.artifactDigest !== manifest.source.artifactDigest || evidence.sourceRevision !== manifest.source.revision) {
    throw new Error('artifact evidence identity does not match manifest')
  }
  if (evidence.decision !== 'verified' || requiredChecks.some(check => evidence.checks[check] !== 'pass')) throw new Error('every artifact evidence check must pass')
  if (!evidence.policyRevision.trim() || Number.isNaN(Date.parse(evidence.evaluatedAt))) throw new Error('artifact evidence provenance is invalid')
  if (manifest.source.signature.status !== 'verified' || manifest.source.sbom.format === 'none' || !manifest.source.sbom.digest) throw new Error('manifest must carry verified signature and SBOM evidence')
  return deepFreeze({
    schemaVersion: 1,
    candidateId: candidate.id,
    manifest: structuredClone(manifest),
    manifestDigest: contentDigest(manifest),
    evidencePolicyRevision: evidence.policyRevision,
    status: 'validated-unpublished',
    publicationAllowed: false,
    activationAllowed: false,
    currentOwnerPreserved: true,
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
