import { createHash } from 'node:crypto'
import type { PlatformFacilityCatalogV1, PlatformFacilityDescriptorV1, PlatformFacilitySpecV1 } from './facilities.js'
import type { CapabilityOfferCatalogV1 } from './offers.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}(?:\/[a-z0-9][a-z0-9.-]{0,63})?$/

export function compilePlatformFacilities(offers: CapabilityOfferCatalogV1, specs: readonly PlatformFacilitySpecV1[]): PlatformFacilityCatalogV1 {
  const coreOffers = offers.offers.filter(offer => offer.availability === 'core-bound')
  const covered = new Set<string>()
  const ids = new Set<string>()
  const facilities: PlatformFacilityDescriptorV1[] = specs.map(spec => {
    if (spec.schemaVersion !== 1 || !idPattern.test(spec.id) || !spec.name.trim() || !spec.targetPlane.trim()) throw new Error('platform facility identity is invalid')
    if (spec.installable !== false || spec.replaceableByPrivatePack !== false) throw new Error(`platform facility ${spec.id} cannot be installable or private-replaceable`)
    if (ids.has(spec.id)) throw new Error(`duplicate platform facility ${spec.id}`)
    ids.add(spec.id)
    const modules = coreOffers.filter(offer => offer.targetPlane === spec.targetPlane).map(offer => offer.moduleId).sort()
    if (!modules.length) throw new Error(`platform facility ${spec.id} has no core offers`)
    for (const moduleId of modules) {
      if (covered.has(moduleId)) throw new Error(`core module ${moduleId} is assigned to multiple platform facilities`)
      covered.add(moduleId)
    }
    return Object.freeze({
      ...spec,
      moduleIds: modules,
      moduleDigest: `sha256:${createHash('sha256').update(modules.join('\n')).digest('hex')}`,
      currentOwnerPreserved: true as const,
    })
  })
  const uncoveredModuleIds = coreOffers.filter(offer => !covered.has(offer.moduleId)).map(offer => offer.moduleId)
  if (uncoveredModuleIds.length) throw new Error(`core offers missing platform facilities: ${uncoveredModuleIds.join(',')}`)
  return Object.freeze({ schemaVersion: 1, sourceRevision: offers.sourceRevision, facilities, coveredCoreOfferCount: covered.size, uncoveredModuleIds: [] })
}
