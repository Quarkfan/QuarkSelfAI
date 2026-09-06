import { createHash } from 'node:crypto'
import type { CapabilityArtifactCandidateCatalogV1, CapabilityArtifactCandidateSpecV1, CompiledCapabilityArtifactCandidateV1 } from './artifact-candidates.js'
import type { CapabilityOfferCatalogV1, ModuleCapabilityOfferV1 } from './offers.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}(?:\/[a-z0-9][a-z0-9.-]{0,63})?$/
const artifactKinds = new Set([
  'skill', 'knowledge', 'policy', 'workflow', 'connector', 'package', 'sdk', 'cli', 'binary', 'project',
  'browser-runtime', 'container', 'notebook', 'sandbox', 'application', 'game', 'simulation', 'integration-pack',
  'agent', 'composite',
])
const blockers = new Set([
  'artifact-digest-missing', 'license-decision-missing', 'lifecycle-contract-missing', 'permission-review-missing',
  'sbom-missing', 'signature-missing', 'private-manifest-required',
])

export function compileCapabilityArtifactCandidates(
  offers: CapabilityOfferCatalogV1,
  specs: readonly CapabilityArtifactCandidateSpecV1[],
): CapabilityArtifactCandidateCatalogV1 {
  if (!/^[a-f0-9]{40}$/.test(offers.sourceRevision)) throw new Error('candidate catalog requires an exact source revision')
  const eligible = offers.offers.filter(isArtifactOffer)
  const eligibleById = new Map(eligible.map(offer => [offer.moduleId, offer]))
  const assigned = new Set<string>()
  const candidateIds = new Set<string>()
  const compiled: CompiledCapabilityArtifactCandidateV1[] = []

  for (const spec of specs) {
    validateSpec(spec)
    if (candidateIds.has(spec.id)) throw new Error(`duplicate capability candidate ${spec.id}`)
    candidateIds.add(spec.id)
    const selected = spec.offerSelector === 'all-private-pack-offers'
      ? eligible.filter(offer => offer.availability === 'private-pack-inactive')
      : spec.moduleIds.map(moduleId => {
          const offer = eligibleById.get(moduleId)
          if (!offer) throw new Error(`candidate ${spec.id} references ineligible or unknown module ${moduleId}`)
          if (offer.availability === 'private-pack-inactive') throw new Error(`candidate ${spec.id} cannot expose private module assignments`)
          return offer
        })
    if (!selected.length) throw new Error(`candidate ${spec.id} has no eligible offers`)
    for (const offer of selected) {
      if (assigned.has(offer.moduleId)) throw new Error(`module ${offer.moduleId} is assigned to multiple capability candidates`)
      assigned.add(offer.moduleId)
    }
    const privateCandidate = spec.offerSelector === 'all-private-pack-offers'
    if (privateCandidate && (spec.targetPlane !== 'private-pack' || spec.kind !== 'integration-pack' || !spec.blockers.includes('private-manifest-required'))) {
      throw new Error('private candidate must remain an integration-pack with a private manifest blocker')
    }
    const ids = selected.map(item => item.moduleId).sort()
    compiled.push(Object.freeze({
      schemaVersion: 1,
      id: spec.id,
      name: spec.name,
      kind: spec.kind,
      targetPlane: spec.targetPlane,
      moduleIds: privateCandidate ? [] : ids,
      coveredModuleCount: ids.length,
      coveredModuleDigest: `sha256:${createHash('sha256').update(ids.join('\n')).digest('hex')}`,
      blockers: [...spec.blockers].sort(),
      manifestStatus: 'evidence-pending',
      activationAllowed: false,
      publicationAllowed: false,
      currentOwnerPreserved: true,
    }))
  }

  const uncoveredModuleIds = eligible.filter(offer => !assigned.has(offer.moduleId)).map(offer => offer.moduleId)
  if (uncoveredModuleIds.length) throw new Error(`artifact offers missing capability candidates: ${uncoveredModuleIds.join(',')}`)
  return Object.freeze({
    schemaVersion: 1,
    sourceRevision: offers.sourceRevision,
    candidates: compiled,
    eligibleOfferCount: eligible.length,
    coveredOfferCount: assigned.size,
    uncoveredModuleIds: [],
  })
}

function isArtifactOffer(offer: ModuleCapabilityOfferV1): boolean {
  return offer.availability === 'manifest-pending' || offer.availability === 'private-pack-inactive'
}

function validateSpec(spec: CapabilityArtifactCandidateSpecV1): void {
  if (spec.schemaVersion !== 1 || !idPattern.test(spec.id) || !spec.name.trim()) throw new Error('capability candidate identity is invalid')
  if (!artifactKinds.has(spec.kind)) throw new Error(`candidate ${spec.id} has invalid artifact kind`)
  if (spec.activationAllowed !== false || spec.publicationAllowed !== false) throw new Error(`candidate ${spec.id} must remain inactive and unpublished`)
  if (!spec.blockers.length || spec.blockers.some(blocker => !blockers.has(blocker)) || new Set(spec.blockers).size !== spec.blockers.length) {
    throw new Error(`candidate ${spec.id} requires unique known evidence blockers`)
  }
  if (spec.offerSelector === 'explicit-modules' && !spec.moduleIds.length) throw new Error(`candidate ${spec.id} requires explicit modules`)
  if (spec.offerSelector === 'all-private-pack-offers' && spec.moduleIds.length) throw new Error(`candidate ${spec.id} cannot list private module ids`)
}
