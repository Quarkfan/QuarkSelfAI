import type { CapabilityOfferCatalogV1, CapabilityOfferDisposition, ModuleCapabilityOfferV1 } from './offers.js'
import type { AssistantModuleCatalog, AssistantModuleDescriptor } from '../platform/modules.js'

export interface CapabilityMigrationDesignV1 {
  readonly rules: { readonly exactlyOnce: boolean; readonly activationAllowed: boolean; readonly runtimeCompositionChangeAllowed: boolean }
  readonly groups: readonly { readonly disposition: string; readonly targetPlane: string; readonly moduleIds: readonly string[] }[]
}

const dispositions: Readonly<Record<string, CapabilityOfferDisposition>> = {
  'platform-core': 'merge-platform-core',
  'capability-artifact': 'convert-capability-artifact',
  'experience-artifact': 'convert-capability-artifact',
  'operations-capability': 'convert-capability-artifact',
  'private-work-integration': 'move-private-pack',
  'migration-only': 'retain-migration-tool',
}

export function compileModuleCapabilityOffers(catalog: AssistantModuleCatalog, design: CapabilityMigrationDesignV1, sourceRevision: string): CapabilityOfferCatalogV1 {
  if (!design.rules.exactlyOnce || design.rules.activationAllowed || design.rules.runtimeCompositionChangeAllowed) throw new Error('migration design is not safe for inactive offer compilation')
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('offer catalog requires an exact source revision')
  const assignment = new Map<string, { disposition: CapabilityOfferDisposition; targetPlane: string }>()
  for (const group of design.groups) {
    const disposition = dispositions[group.disposition]
    if (!disposition) throw new Error(`unknown migration disposition ${group.disposition}`)
    for (const moduleId of group.moduleIds) {
      if (assignment.has(moduleId)) throw new Error(`module ${moduleId} has multiple capability offers`)
      assignment.set(moduleId, { disposition, targetPlane: group.targetPlane })
    }
  }
  const moduleIds = new Set(catalog.modules.map(module => module.id))
  const unknown = [...assignment.keys()].filter(id => !moduleIds.has(id))
  if (unknown.length) throw new Error(`offer design references unknown modules: ${unknown.join(',')}`)
  const unclassifiedModuleIds = catalog.modules.filter(module => !assignment.has(module.id)).map(module => module.id)
  if (unclassifiedModuleIds.length) throw new Error(`modules missing capability offers: ${unclassifiedModuleIds.join(',')}`)
  const offers = catalog.modules.flatMap(module => {
    const target = assignment.get(module.id)
    return target ? [offer(module, target, sourceRevision)] : []
  })
  const counts = { 'core-bound': 0, 'manifest-pending': 0, 'private-pack-inactive': 0, 'migration-only': 0 }
  for (const item of offers) counts[item.availability] += 1
  return Object.freeze({ schemaVersion: 1, sourceRevision, offers, counts, unclassifiedModuleIds: [] })
}

function offer(module: AssistantModuleDescriptor, target: { disposition: CapabilityOfferDisposition; targetPlane: string }, sourceRevision: string): ModuleCapabilityOfferV1 {
  const availability = target.disposition === 'merge-platform-core' ? 'core-bound'
    : target.disposition === 'move-private-pack' ? 'private-pack-inactive'
      : target.disposition === 'retain-migration-tool' || target.disposition === 'retire-after-replacement' ? 'migration-only'
        : 'manifest-pending'
  const sources = target.disposition === 'move-private-pack' ? [] : [...new Set([module.source, ...module.owns, ...module.assets])]
  if (sources.some(path => path.startsWith('/') || path.includes('..'))) throw new Error(`module ${module.id} has a non-portable source reference`)
  if (availability === 'migration-only' && !module.exitCriteria) throw new Error(`migration offer ${module.id} requires exit criteria`)
  return Object.freeze({
    schemaVersion: 1,
    moduleId: module.id,
    sourceRevision,
    disposition: target.disposition,
    targetPlane: target.targetPlane,
    currentRuntime: module.runtime,
    sourceReferences: sources,
    dependencyModuleIds: [...new Set([...module.dependsOn, ...module.runtimeDependsOn, ...module.mounts])],
    availability,
    activationAllowed: false,
    currentOwnerPreserved: true,
    exitCriteria: module.exitCriteria ?? null,
  })
}
