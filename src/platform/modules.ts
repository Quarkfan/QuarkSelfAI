export type ModuleClassification = 'skeleton' | 'feature' | 'migration'
export type ModuleLayer = 'kernel' | 'contract' | 'adapter' | 'provider' | 'policy' | 'workflow' | 'projection' | 'surface' | 'operations'
export type ModuleImplementation = 'planned' | 'partial' | 'ready'
export type ModuleRuntime = 'static' | 'inactive' | 'shadow' | 'active' | 'compat'

export interface AssistantPluginBinding {
  /** Stable instance id in the bundled Cordis profile. */
  readonly profileId: string
  /** Package export key, for example `.` or `./message-intake`. */
  readonly packageExport: string
}

export interface AssistantModuleDescriptor {
  readonly id: string
  readonly classification: ModuleClassification
  /** Source dependency tier. The catalog enforces an inward-only layer matrix. */
  readonly layer: ModuleLayer
  /** Code maturity. This must not be used as a claim about production ownership. */
  readonly implementation: ModuleImplementation
  /** Current runtime ownership. Only active providers satisfy active consumers. */
  readonly runtime: ModuleRuntime
  readonly source: string
  /** Exact native, compatibility, or operational source files owned by this module. */
  readonly owns: readonly string[]
  /** Exact tracked runtime/configuration assets maintained by this module. */
  readonly assets: readonly string[]
  /** Exact cross-module source imports. Architecture checks reject missing and stale entries. */
  readonly dependsOn: readonly string[]
  /** Runtime/plugin injection relationships that do not create a source import. */
  readonly runtimeDependsOn: readonly string[]
  readonly requiresEffects: readonly string[]
  readonly providesEffects: readonly string[]
  /** Present only when this module owns a loadable plugin entrypoint. */
  readonly plugin?: AssistantPluginBinding
  readonly hostedBy?: string
  readonly exitCriteria?: string
}

export interface AssistantModuleCatalog {
  readonly version: 3
  readonly modules: readonly AssistantModuleDescriptor[]
}

export interface ModuleCatalogProvider {
  load(): Promise<AssistantModuleCatalog>
}

/** Neutral catalog for hosts that intentionally do not mount a product composition. */
export class EmptyModuleCatalogProvider implements ModuleCatalogProvider {
  async load(): Promise<AssistantModuleCatalog> { return { version: 3, modules: [] } }
}

export interface EffectCoverage {
  readonly required: readonly string[]
  readonly declared: readonly string[]
  readonly implemented: readonly string[]
  readonly active: readonly string[]
  readonly missingImplementation: readonly string[]
  readonly inactive: readonly string[]
}

export interface ModuleSummary {
  readonly total: number
  readonly classification: Record<ModuleClassification, number>
  readonly implementation: Record<ModuleImplementation, number>
  readonly runtime: Record<ModuleRuntime, number>
}

const classifications = new Set<ModuleClassification>(['skeleton', 'feature', 'migration'])
const layers = new Set<ModuleLayer>(['kernel', 'contract', 'adapter', 'provider', 'policy', 'workflow', 'projection', 'surface', 'operations'])
const implementations = new Set<ModuleImplementation>(['planned', 'partial', 'ready'])
const runtimes = new Set<ModuleRuntime>(['static', 'inactive', 'shadow', 'active', 'compat'])
const sourceDependencyLayers: Readonly<Record<ModuleLayer, ReadonlySet<ModuleLayer>>> = {
  contract: new Set(['contract']),
  kernel: new Set(['contract', 'kernel']),
  policy: new Set(['contract', 'policy']),
  provider: new Set(['contract', 'kernel', 'policy', 'provider']),
  adapter: new Set(['contract', 'kernel', 'adapter']),
  workflow: new Set(['contract', 'kernel', 'policy', 'workflow']),
  projection: new Set(['contract', 'kernel', 'policy', 'projection']),
  surface: new Set(['contract', 'kernel', 'policy', 'surface']),
  operations: new Set(layers),
}
const catalogFields = new Set(['version', 'modules'])
const moduleFields = new Set([
  'id', 'classification', 'layer', 'implementation', 'runtime', 'source', 'owns', 'assets', 'dependsOn',
  'runtimeDependsOn', 'requiresEffects', 'providesEffects', 'plugin', 'hostedBy', 'exitCriteria',
])

export function validateModuleCatalog(value: unknown): AssistantModuleCatalog {
  if (!isRecord(value) || value.version !== 3 || !Array.isArray(value.modules)) {
    throw new Error('module catalog must be a version 3 object with a modules array')
  }
  const unknownCatalogFields = Object.keys(value).filter(key => !catalogFields.has(key))
  if (unknownCatalogFields.length) throw new Error(`module catalog has unknown fields: ${unknownCatalogFields.join(', ')}`)
  const modules = value.modules.map(parseModule)
  const byId = new Map<string, AssistantModuleDescriptor>()
  for (const module of modules) {
    if (byId.has(module.id)) throw new Error(`duplicate module id: ${module.id}`)
    byId.set(module.id, module)
  }
  for (const module of modules) {
    for (const dependencyId of [...module.dependsOn, ...module.runtimeDependsOn]) {
      const dependency = byId.get(dependencyId)
      if (!dependency) throw new Error(`module ${module.id} depends on unknown module ${dependencyId}`)
      if (module.classification === 'skeleton' && dependency.classification !== 'skeleton') {
        throw new Error(`skeleton module ${module.id} cannot depend on ${dependency.classification} module ${dependencyId}`)
      }
      if (module.classification === 'feature' && dependency.classification === 'migration') {
        throw new Error(`feature module ${module.id} cannot depend on migration module ${dependencyId}`)
      }
    }
    for (const dependencyId of module.dependsOn) {
      const dependency = byId.get(dependencyId)!
      if (!sourceDependencyLayers[module.layer].has(dependency.layer)) {
        throw new Error(`${module.layer} module ${module.id} cannot source-depend on ${dependency.layer} module ${dependencyId}`)
      }
    }
    if (module.runtime === 'compat') {
      if (module.classification !== 'feature') throw new Error(`only feature modules can use runtime=compat: ${module.id}`)
      const host = module.hostedBy ? byId.get(module.hostedBy) : undefined
      if (!host || host.classification !== 'migration') {
        throw new Error(`compat module ${module.id} must name a migration host`)
      }
    } else if (module.hostedBy !== undefined) {
      throw new Error(`module ${module.id} can declare hostedBy only with runtime=compat`)
    }
    if (module.runtime === 'active' && module.implementation !== 'ready') {
      throw new Error(`active module ${module.id} must have a ready implementation`)
    }
    if (module.layer === 'contract' && module.runtime !== 'static') {
      throw new Error(`contract module ${module.id} must use runtime=static`)
    }
    if (module.layer !== 'contract' && module.runtime === 'static') {
      throw new Error(`only contract modules can use runtime=static: ${module.id}`)
    }
    if (module.runtime === 'static' && module.runtimeDependsOn.length > 0) {
      throw new Error(`static contract module ${module.id} cannot declare runtime dependencies`)
    }
    if (module.classification === 'skeleton'
      && (module.implementation !== 'ready' || (module.layer === 'contract' ? module.runtime !== 'static' : module.runtime !== 'active'))) {
      throw new Error(`skeleton module ${module.id} must be ready and its executable runtime must be active`)
    }
    if (module.classification === 'migration' && !module.exitCriteria?.trim()) {
      throw new Error(`migration module ${module.id} must define exitCriteria`)
    }
    if (module.classification !== 'migration' && module.exitCriteria !== undefined) {
      throw new Error(`only migration modules can declare exitCriteria: ${module.id}`)
    }
    if (module.source.startsWith('src/') && !module.owns.includes(module.source)) {
      throw new Error(`module ${module.id} must own its src entrypoint ${module.source}`)
    }
  }
  const ownership = new Map<string, string>()
  const assetOwnership = new Map<string, string>()
  const effectProviders = new Map<string, AssistantModuleDescriptor>()
  const pluginProfiles = new Map<string, string>()
  const pluginExports = new Map<string, string>()
  for (const module of modules) {
    for (const source of module.owns) {
      const existing = ownership.get(source)
      if (existing) throw new Error(`source ${source} is owned by both ${existing} and ${module.id}`)
      ownership.set(source, module.id)
    }
    for (const asset of module.assets) {
      const existing = assetOwnership.get(asset)
      if (existing) throw new Error(`asset ${asset} is owned by both ${existing} and ${module.id}`)
      assetOwnership.set(asset, module.id)
    }
    for (const effect of module.providesEffects) {
      const existing = effectProviders.get(effect)
      if (existing) throw new Error(`effect ${effect} is provided by both ${existing.id} and ${module.id}`)
      effectProviders.set(effect, module)
    }
    if (module.plugin) {
      const profileOwner = pluginProfiles.get(module.plugin.profileId)
      if (profileOwner) throw new Error(`plugin profile ${module.plugin.profileId} is owned by both ${profileOwner} and ${module.id}`)
      pluginProfiles.set(module.plugin.profileId, module.id)
      const exportOwner = pluginExports.get(module.plugin.packageExport)
      if (exportOwner) throw new Error(`plugin export ${module.plugin.packageExport} is owned by both ${exportOwner} and ${module.id}`)
      pluginExports.set(module.plugin.packageExport, module.id)
    }
  }
  for (const module of modules.filter(item => item.runtime === 'active')) {
    for (const effect of module.requiresEffects) {
      if (effectProviders.get(effect)?.runtime !== 'active') throw new Error(`active module ${module.id} requires inactive effect ${effect}`)
    }
  }
  assertAcyclic(modules, byId)
  return { version: 3, modules }
}

export function analyzeEffectCoverage(catalog: AssistantModuleCatalog): EffectCoverage {
  const required = [...new Set(catalog.modules.flatMap(module => module.requiresEffects))].sort()
  const declared = [...new Set(catalog.modules.flatMap(module => module.providesEffects))].sort()
  const implementedProviders = new Set(catalog.modules.filter(module => module.implementation === 'ready').flatMap(module => module.providesEffects))
  const activeProviders = new Set(catalog.modules.filter(module => module.runtime === 'active').flatMap(module => module.providesEffects))
  const implemented = required.filter(effect => implementedProviders.has(effect))
  const active = required.filter(effect => activeProviders.has(effect))
  const implementedSet = new Set(implemented)
  const activeSet = new Set(active)
  return {
    required, declared, implemented, active,
    missingImplementation: required.filter(effect => !implementedSet.has(effect)),
    inactive: required.filter(effect => implementedSet.has(effect) && !activeSet.has(effect)),
  }
}

export function validateSourceOwnership(catalog: AssistantModuleCatalog, sourceFiles: readonly string[]): void {
  const expected = new Set(sourceFiles)
  const owned = new Map(catalog.modules.flatMap(module => module.owns.map(source => [source, module.id] as const)))
  const missing = [...expected].filter(source => !owned.has(source)).sort()
  const stale = [...owned.keys()].filter(source => !expected.has(source)).sort()
  if (missing.length || stale.length) {
    const details = [
      ...missing.map(source => `unowned source: ${source}`),
      ...stale.map(source => `owned source does not exist: ${source}`),
    ]
    throw new Error(`source ownership violations:\n${details.join('\n')}`)
  }
}

export function validateAssetOwnership(catalog: AssistantModuleCatalog, assetFiles: readonly string[]): void {
  const expected = new Set(assetFiles)
  const owned = new Map(catalog.modules.flatMap(module => module.assets.map(asset => [asset, module.id] as const)))
  const missing = [...expected].filter(asset => !owned.has(asset)).sort()
  const stale = [...owned.keys()].filter(asset => !expected.has(asset)).sort()
  if (missing.length || stale.length) {
    const details = [
      ...missing.map(asset => `unowned runtime asset: ${asset}`),
      ...stale.map(asset => `owned runtime asset does not exist or is not tracked: ${asset}`),
    ]
    throw new Error(`runtime asset ownership violations:\n${details.join('\n')}`)
  }
}

export function summarizeModules(catalog: AssistantModuleCatalog): ModuleSummary {
  const summary: ModuleSummary = {
    total: catalog.modules.length,
    classification: { skeleton: 0, feature: 0, migration: 0 },
    implementation: { planned: 0, partial: 0, ready: 0 },
    runtime: { static: 0, inactive: 0, shadow: 0, active: 0, compat: 0 },
  }
  for (const module of catalog.modules) {
    summary.classification[module.classification] += 1
    summary.implementation[module.implementation] += 1
    summary.runtime[module.runtime] += 1
  }
  return summary
}

function parseModule(value: unknown): AssistantModuleDescriptor {
  if (!isRecord(value)) throw new Error('each module descriptor must be an object')
  if ('status' in value) throw new Error('module uses ambiguous legacy status; use implementation and runtime')
  const unknownFields = Object.keys(value).filter(key => !moduleFields.has(key))
  if (unknownFields.length) throw new Error(`module descriptor has unknown fields: ${unknownFields.join(', ')}`)
  const id = string(value.id, 'module id')
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`invalid module id: ${id}`)
  const classification = string(value.classification, `classification for ${id}`) as ModuleClassification
  const layer = string(value.layer, `layer for ${id}`) as ModuleLayer
  const implementation = string(value.implementation, `implementation for ${id}`) as ModuleImplementation
  const runtime = string(value.runtime, `runtime for ${id}`) as ModuleRuntime
  if (!classifications.has(classification)) throw new Error(`invalid classification for ${id}: ${classification}`)
  if (!layers.has(layer)) throw new Error(`invalid layer for ${id}: ${layer}`)
  if (!implementations.has(implementation)) throw new Error(`invalid implementation for ${id}: ${implementation}`)
  if (!runtimes.has(runtime)) throw new Error(`invalid runtime for ${id}: ${runtime}`)
  if (!Array.isArray(value.dependsOn) || value.dependsOn.some(item => typeof item !== 'string')) {
    throw new Error(`dependsOn for ${id} must be a string array`)
  }
  if (value.runtimeDependsOn !== undefined
    && (!Array.isArray(value.runtimeDependsOn) || value.runtimeDependsOn.some(item => typeof item !== 'string'))) {
    throw new Error(`runtimeDependsOn for ${id} must be a string array`)
  }
  if (!Array.isArray(value.owns) || value.owns.some(item => typeof item !== 'string')) {
    throw new Error(`owns for ${id} must be a string array`)
  }
  const owns = [...new Set(value.owns as string[])]
  if (owns.length !== value.owns.length) throw new Error(`owns for ${id} must not contain duplicates`)
  for (const ownedSource of owns) {
    if (!/^(?:src\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts|packages\/bridge-compat\/src\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js|scripts\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:ts|mjs))$/.test(ownedSource)) {
      throw new Error(`invalid owned source for ${id}: ${ownedSource}`)
    }
  }
  if (value.assets !== undefined
    && (!Array.isArray(value.assets) || value.assets.some(item => typeof item !== 'string'))) {
    throw new Error(`assets for ${id} must be a string array`)
  }
  const assets = [...new Set((value.assets ?? []) as string[])]
  if (assets.length !== (value.assets ?? []).length) throw new Error(`assets for ${id} must not contain duplicates`)
  for (const asset of assets) {
    if (!normalizedProjectPath(asset)) throw new Error(`invalid runtime asset for ${id}: ${asset}`)
  }
  const dependsOn = [...new Set(value.dependsOn as string[])]
  if (dependsOn.length !== value.dependsOn.length) throw new Error(`dependsOn for ${id} must not contain duplicates`)
  const runtimeDependsOn = [...new Set((value.runtimeDependsOn ?? []) as string[])]
  if (runtimeDependsOn.length !== (value.runtimeDependsOn ?? []).length) throw new Error(`runtimeDependsOn for ${id} must not contain duplicates`)
  const overlappingDependencies = dependsOn.filter(dependency => runtimeDependsOn.includes(dependency))
  if (overlappingDependencies.length) throw new Error(`module ${id} declares both source and runtime dependency on ${overlappingDependencies.join(', ')}`)
  const requiresEffects = effectList(value.requiresEffects, `requiresEffects for ${id}`)
  const providesEffects = effectList(value.providesEffects, `providesEffects for ${id}`)
  if (dependsOn.includes(id)) throw new Error(`module ${id} cannot depend on itself`)
  if (runtimeDependsOn.includes(id)) throw new Error(`module ${id} cannot depend on itself`)
  const hostedBy = value.hostedBy === undefined ? undefined : string(value.hostedBy, `hostedBy for ${id}`)
  const exitCriteria = value.exitCriteria === undefined ? undefined : string(value.exitCriteria, `exitCriteria for ${id}`)
  const source = string(value.source, `source for ${id}`)
  if (source !== source.trim() || source.startsWith('/') || source.includes('\\')
    || source.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error(`source for ${id} must be a normalized project-relative path: ${source}`)
  }
  return {
    id,
    classification,
    layer,
    implementation,
    runtime,
    source,
    owns,
    assets,
    dependsOn,
    runtimeDependsOn,
    requiresEffects,
    providesEffects,
    ...(value.plugin === undefined ? {} : { plugin: parsePlugin(value.plugin, id) }),
    ...(hostedBy === undefined ? {} : { hostedBy }),
    ...(exitCriteria === undefined ? {} : { exitCriteria }),
  }
}

function normalizedProjectPath(value: string): boolean {
  return Boolean(value.trim()) && value === value.trim() && !value.startsWith('/') && !value.includes('\\')
    && !value.split('/').some(segment => !segment || segment === '.' || segment === '..')
}

function parsePlugin(value: unknown, moduleId: string): AssistantPluginBinding {
  if (!isRecord(value)) throw new Error(`plugin for ${moduleId} must be an object`)
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'profileId' && key !== 'packageExport')) throw new Error(`plugin for ${moduleId} has unknown fields`)
  const profileId = string(value.profileId, `plugin profileId for ${moduleId}`)
  const packageExport = string(value.packageExport, `plugin packageExport for ${moduleId}`)
  if (!/^[a-z][a-z0-9-]*$/.test(profileId)) throw new Error(`invalid plugin profileId for ${moduleId}: ${profileId}`)
  if (packageExport !== '.' && !/^\.\/[a-z0-9-]+$/.test(packageExport)) throw new Error(`invalid plugin packageExport for ${moduleId}: ${packageExport}`)
  return { profileId, packageExport }
}

function effectList(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be a string array`)
  const result = [...new Set(value as string[])]
  if (result.length !== value.length) throw new Error(`${label} must not contain duplicates`)
  for (const effect of result) {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\.v[1-9][0-9]*$/.test(effect)) throw new Error(`invalid effect id in ${label}: ${effect}`)
  }
  return result
}

function assertAcyclic(modules: readonly AssistantModuleDescriptor[], byId: ReadonlyMap<string, AssistantModuleDescriptor>): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) throw new Error(`module dependency cycle: ${[...path, id].join(' -> ')}`)
    if (visited.has(id)) return
    visiting.add(id)
    const module = byId.get(id)
    for (const dependency of [...(module?.dependsOn ?? []), ...(module?.runtimeDependsOn ?? [])]) visit(dependency, [...path, id])
    visiting.delete(id)
    visited.add(id)
  }
  for (const module of modules) visit(module.id, [])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}
