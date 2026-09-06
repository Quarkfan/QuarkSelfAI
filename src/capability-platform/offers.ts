import type { ModuleRuntime } from '../platform/modules.js'

export type CapabilityOfferDisposition =
  | 'merge-platform-core'
  | 'convert-capability-artifact'
  | 'move-private-pack'
  | 'retain-migration-tool'
  | 'retire-after-replacement'

export interface ModuleCapabilityOfferV1 {
  readonly schemaVersion: 1
  readonly moduleId: string
  readonly sourceRevision: string
  readonly disposition: CapabilityOfferDisposition
  readonly targetPlane: string
  readonly currentRuntime: ModuleRuntime
  readonly sourceReferences: readonly string[]
  readonly dependencyModuleIds: readonly string[]
  readonly availability: 'core-bound' | 'manifest-pending' | 'private-pack-inactive' | 'migration-only'
  readonly activationAllowed: false
  readonly currentOwnerPreserved: true
  readonly exitCriteria: string | null
}

export interface CapabilityOfferCatalogV1 {
  readonly schemaVersion: 1
  readonly sourceRevision: string
  readonly offers: readonly ModuleCapabilityOfferV1[]
  readonly counts: Readonly<Record<ModuleCapabilityOfferV1['availability'], number>>
  readonly unclassifiedModuleIds: readonly string[]
}
