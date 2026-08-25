import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { AssistantModuleCatalog } from '../platform/modules.js'

export interface ProductCapabilityDefinition {
  readonly id: string
  readonly required: boolean
  readonly modules: readonly string[]
}

export interface ProductCompositionManifest {
  readonly version: 2
  readonly capabilities: readonly ProductCapabilityDefinition[]
  readonly requiredEnvironment: readonly string[]
  readonly requiredConfiguration: readonly string[]
}

const defaultManifestPath = fileURLToPath(new URL('../../config/product-composition.json', import.meta.url))

export async function loadProductCompositionManifest(
  catalog: AssistantModuleCatalog,
  path = defaultManifestPath,
): Promise<ProductCompositionManifest> {
  return validateProductCompositionManifest(JSON.parse(await readFile(path, 'utf8')), catalog)
}

export function validateProductCompositionManifest(
  value: unknown,
  catalog: AssistantModuleCatalog,
): ProductCompositionManifest {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.capabilities)
    || !Array.isArray(value.requiredConfiguration)) {
    throw new Error('product composition manifest must be a version 2 object')
  }
  if (Object.keys(value).sort().join(',') !== 'capabilities,requiredConfiguration,version') {
    throw new Error('product composition manifest has unknown or missing fields')
  }
  const byModule = new Map(catalog.modules.map(module => [module.id, module]))
  const capabilityIds = new Set<string>()
  const ownedModules = new Set<string>()
  const capabilities = value.capabilities.map((candidate, index): ProductCapabilityDefinition => {
    if (!isRecord(candidate) || Object.keys(candidate).sort().join(',') !== 'id,modules,required') {
      throw new Error(`product capability ${index} has unknown or missing fields`)
    }
    const id = nonEmpty(candidate.id, `product capability ${index} id`)
    if (!/^[a-z][a-z0-9-]*$/.test(id) || capabilityIds.has(id)) throw new Error(`invalid or duplicate product capability id: ${id}`)
    capabilityIds.add(id)
    if (typeof candidate.required !== 'boolean') throw new Error(`product capability ${id} required must be boolean`)
    if (!Array.isArray(candidate.modules) || candidate.modules.length === 0
      || candidate.modules.some(module => typeof module !== 'string' || !module.trim())) {
      throw new Error(`product capability ${id} modules must be a non-empty string array`)
    }
    const modules = [...new Set(candidate.modules as string[])]
    if (modules.length !== candidate.modules.length) throw new Error(`product capability ${id} contains duplicate modules`)
    for (const moduleId of modules) {
      const module = byModule.get(moduleId)
      if (!module) throw new Error(`product capability ${id} references unknown module ${moduleId}`)
      if (module.classification === 'migration' || module.runtime === 'compat') {
        throw new Error(`product capability ${id} references temporary module ${moduleId}`)
      }
      if (ownedModules.has(moduleId)) throw new Error(`product module ${moduleId} belongs to multiple capabilities`)
      ownedModules.add(moduleId)
    }
    return { id, required: candidate.required, modules }
  })
  if (capabilities.length === 0) throw new Error('product composition manifest requires capabilities')
  const requiredEnvironment = [...ownedModules]
    .map(moduleId => byModule.get(moduleId)!)
    .filter(module => module.runtime === 'inactive' && module.plugin)
    .map(module => module.plugin!.activationGate!)
    .sort()
  if (value.requiredConfiguration.some(item => typeof item !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(item))) {
    throw new Error('product requiredConfiguration must contain environment names')
  }
  const requiredConfiguration = [...new Set(value.requiredConfiguration as string[])]
  if (requiredConfiguration.length !== value.requiredConfiguration.length) throw new Error('product requiredConfiguration contains duplicates')
  return { version: 2, capabilities, requiredEnvironment, requiredConfiguration }
}

export function productModuleIds(manifest: ProductCompositionManifest): readonly string[] {
  return manifest.capabilities.flatMap(capability => capability.modules)
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
