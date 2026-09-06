export interface PlatformFacilitySpecV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly targetPlane: string
  readonly selectableByBlueprint: boolean
  readonly installable: false
  readonly replaceableByPrivatePack: false
}

export interface PlatformFacilityDescriptorV1 extends PlatformFacilitySpecV1 {
  readonly moduleIds: readonly string[]
  readonly moduleDigest: string
  readonly currentOwnerPreserved: true
}

export interface PlatformFacilityCatalogV1 {
  readonly schemaVersion: 1
  readonly sourceRevision: string
  readonly facilities: readonly PlatformFacilityDescriptorV1[]
  readonly coveredCoreOfferCount: number
  readonly uncoveredModuleIds: readonly string[]
}
