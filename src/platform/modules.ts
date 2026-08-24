import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export type ModuleClassification = 'skeleton' | 'feature' | 'migration'
export type ModuleLayer = 'kernel' | 'contract' | 'adapter' | 'provider' | 'policy' | 'workflow' | 'projection' | 'surface' | 'operations'
export type ModuleStatus = 'native' | 'compat' | 'planned'

export interface AssistantModuleDescriptor {
  readonly id: string
  readonly classification: ModuleClassification
  readonly layer: ModuleLayer
  readonly status: ModuleStatus
  readonly source: string
  /** Exact src/*.ts files owned by this module. New source files must be assigned explicitly. */
  readonly owns: readonly string[]
  readonly dependsOn: readonly string[]
  readonly hostedBy?: string
  readonly exitCriteria?: string
}

export interface AssistantModuleCatalog {
  readonly version: 1
  readonly modules: readonly AssistantModuleDescriptor[]
}

const catalogPath = fileURLToPath(new URL('../../config/module-catalog.json', import.meta.url))
const classifications = new Set<ModuleClassification>(['skeleton', 'feature', 'migration'])
const layers = new Set<ModuleLayer>(['kernel', 'contract', 'adapter', 'provider', 'policy', 'workflow', 'projection', 'surface', 'operations'])
const statuses = new Set<ModuleStatus>(['native', 'compat', 'planned'])

export async function loadModuleCatalog(path = catalogPath): Promise<AssistantModuleCatalog> {
  return validateModuleCatalog(JSON.parse(await readFile(path, 'utf8')))
}

export function validateModuleCatalog(value: unknown): AssistantModuleCatalog {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.modules)) {
    throw new Error('module catalog must be a version 1 object with a modules array')
  }
  const modules = value.modules.map(parseModule)
  const byId = new Map<string, AssistantModuleDescriptor>()
  for (const module of modules) {
    if (byId.has(module.id)) throw new Error(`duplicate module id: ${module.id}`)
    byId.set(module.id, module)
  }
  for (const module of modules) {
    for (const dependencyId of module.dependsOn) {
      const dependency = byId.get(dependencyId)
      if (!dependency) throw new Error(`module ${module.id} depends on unknown module ${dependencyId}`)
      if (module.classification === 'skeleton' && dependency.classification !== 'skeleton') {
        throw new Error(`skeleton module ${module.id} cannot depend on ${dependency.classification} module ${dependencyId}`)
      }
      if (module.classification === 'feature' && dependency.classification === 'migration') {
        throw new Error(`feature module ${module.id} cannot depend on migration module ${dependencyId}`)
      }
    }
    if (module.status === 'compat') {
      const host = module.hostedBy ? byId.get(module.hostedBy) : undefined
      if (!host || host.classification !== 'migration') {
        throw new Error(`compat module ${module.id} must name a migration host`)
      }
    }
    if (module.classification === 'migration' && !module.exitCriteria?.trim()) {
      throw new Error(`migration module ${module.id} must define exitCriteria`)
    }
    if (module.source.startsWith('src/') && !module.owns.includes(module.source)) {
      throw new Error(`module ${module.id} must own its src entrypoint ${module.source}`)
    }
  }
  const ownership = new Map<string, string>()
  for (const module of modules) {
    for (const source of module.owns) {
      const existing = ownership.get(source)
      if (existing) throw new Error(`source ${source} is owned by both ${existing} and ${module.id}`)
      ownership.set(source, module.id)
    }
  }
  assertAcyclic(modules, byId)
  return { version: 1, modules }
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

export function summarizeModules(catalog: AssistantModuleCatalog): Record<ModuleClassification, Record<ModuleStatus, number>> {
  const summary = {
    skeleton: { native: 0, compat: 0, planned: 0 },
    feature: { native: 0, compat: 0, planned: 0 },
    migration: { native: 0, compat: 0, planned: 0 },
  }
  for (const module of catalog.modules) summary[module.classification][module.status] += 1
  return summary
}

function parseModule(value: unknown): AssistantModuleDescriptor {
  if (!isRecord(value)) throw new Error('each module descriptor must be an object')
  const id = string(value.id, 'module id')
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`invalid module id: ${id}`)
  const classification = string(value.classification, `classification for ${id}`) as ModuleClassification
  const layer = string(value.layer, `layer for ${id}`) as ModuleLayer
  const status = string(value.status, `status for ${id}`) as ModuleStatus
  if (!classifications.has(classification)) throw new Error(`invalid classification for ${id}: ${classification}`)
  if (!layers.has(layer)) throw new Error(`invalid layer for ${id}: ${layer}`)
  if (!statuses.has(status)) throw new Error(`invalid status for ${id}: ${status}`)
  if (!Array.isArray(value.dependsOn) || value.dependsOn.some(item => typeof item !== 'string')) {
    throw new Error(`dependsOn for ${id} must be a string array`)
  }
  if (!Array.isArray(value.owns) || value.owns.some(item => typeof item !== 'string')) {
    throw new Error(`owns for ${id} must be a string array`)
  }
  const owns = [...new Set(value.owns as string[])]
  if (owns.length !== value.owns.length) throw new Error(`owns for ${id} must not contain duplicates`)
  for (const ownedSource of owns) {
    if (!/^src\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts$/.test(ownedSource)) {
      throw new Error(`invalid owned source for ${id}: ${ownedSource}`)
    }
  }
  const dependsOn = [...new Set(value.dependsOn as string[])]
  if (dependsOn.includes(id)) throw new Error(`module ${id} cannot depend on itself`)
  return {
    id,
    classification,
    layer,
    status,
    source: string(value.source, `source for ${id}`),
    owns,
    dependsOn,
    ...(typeof value.hostedBy === 'string' ? { hostedBy: value.hostedBy } : {}),
    ...(typeof value.exitCriteria === 'string' ? { exitCriteria: value.exitCriteria } : {}),
  }
}

function assertAcyclic(modules: readonly AssistantModuleDescriptor[], byId: ReadonlyMap<string, AssistantModuleDescriptor>): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) throw new Error(`module dependency cycle: ${[...path, id].join(' -> ')}`)
    if (visited.has(id)) return
    visiting.add(id)
    const module = byId.get(id)
    for (const dependency of module?.dependsOn ?? []) visit(dependency, [...path, id])
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
