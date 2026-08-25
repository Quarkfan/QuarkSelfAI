import {
  analyzeModuleRuntimeGraph, moduleRuntimeDependencyClosure,
  type AssistantModuleCatalog, type ModuleCatalogProvider,
} from '../platform/modules.js'
import type {
  KernelStatusProvider,
  OperationalReadinessProvider,
  OperationalReadinessReport,
  RuntimeCapabilityStatus,
  RuntimeSnapshot,
  RuntimeStatusProvider,
} from '../platform/operations.js'
import type { ProductCompositionManifest } from './manifest.js'

export class NativeProductRuntimeStatus implements RuntimeStatusProvider {
  constructor(
    private readonly kernel: KernelStatusProvider,
    private readonly catalog: AssistantModuleCatalog,
    private readonly manifest: ProductCompositionManifest,
    private readonly storageModuleId: string,
  ) {}

  snapshot(): RuntimeSnapshot {
    const kernel = this.kernel.snapshot()
    const capabilities = this.manifest.capabilities.map(capability => this.capability(capability.id, capability.required, capability.modules, kernel.state))
    capabilities.push(this.capability('storage-provider', true, [this.storageModuleId], kernel.state))
    const requiredRoots = [
      ...this.manifest.capabilities.filter(capability => capability.required).flatMap(capability => capability.modules),
      this.storageModuleId,
    ]
    const requiredClosure = moduleRuntimeDependencyClosure(this.catalog, requiredRoots)
    const runtimeDependencies = requiredClosure
      .filter(id => !requiredRoots.includes(id))
    capabilities.push(this.capability('platform-runtime-dependencies', true, runtimeDependencies, kernel.state))
    const requiredSet = new Set(requiredClosure)
    const unresolved = analyzeModuleRuntimeGraph(this.catalog).unresolved.filter(requirement => requiredSet.has(requirement.from))
    capabilities.push({
      id: 'platform-runtime-requirements', required: true,
      state: kernel.state === 'ready' ? unresolved.length ? 'degraded' : 'ready' : kernel.state,
      ...(unresolved.length ? { detail: `unresolved capabilities: ${unresolved.map(requirement => `${requirement.from}:${requirement.kind}:${requirement.capability}`).join(',')}` } : {}),
    })
    const required = capabilities.filter(capability => capability.required)
    const state = kernel.state === 'ready' && required.every(capability => capability.state === 'ready')
      ? 'ready'
      : kernel.state === 'failed' ? 'failed'
        : kernel.state === 'stopped' ? 'stopped'
          : kernel.state === 'starting' ? 'starting' : 'degraded'
    return {
      mode: 'native-product', operationalMode: 'native', requiredForHealth: true,
      state, capabilities,
      ...(kernel.pid === undefined ? {} : { pid: kernel.pid }),
      ...(kernel.startedAt === undefined ? {} : { startedAt: kernel.startedAt }),
      ...(kernel.lastError === undefined ? {} : { lastError: kernel.lastError }),
    }
  }

  private capability(
    id: string,
    required: boolean,
    moduleIds: readonly string[],
    kernelState: RuntimeSnapshot['state'],
  ): RuntimeCapabilityStatus {
    const modules = new Map(this.catalog.modules.map(module => [module.id, module]))
    const unavailable = moduleIds.filter(moduleId => {
      const runtime = modules.get(moduleId)?.runtime
      return runtime !== 'active' && runtime !== 'static'
    })
    const state = kernelState === 'ready'
      ? unavailable.length ? 'degraded' : 'ready'
      : kernelState
    return {
      id, required, state,
      ...(unavailable.length ? { detail: `inactive modules: ${unavailable.join(',')}` } : {}),
    }
  }
}

export class NativeProductReadiness implements OperationalReadinessProvider {
  constructor(
    private readonly catalog: ModuleCatalogProvider,
    private readonly manifest: ProductCompositionManifest,
    private readonly storageModuleId: string,
  ) {}

  async inspect(): Promise<OperationalReadinessReport> {
    const catalog = await this.catalog.load()
    const roots = [...this.manifest.capabilities.flatMap(capability => capability.modules), this.storageModuleId]
    const requiredRoots = [
      ...this.manifest.capabilities.filter(capability => capability.required).flatMap(capability => capability.modules),
      this.storageModuleId,
    ]
    const listed = [...new Set([...roots, ...moduleRuntimeDependencyClosure(catalog, roots)])]
    const required = new Set(moduleRuntimeDependencyClosure(catalog, requiredRoots))
    const graph = analyzeModuleRuntimeGraph(catalog)
    const listedSet = new Set(listed)
    const unresolved = graph.unresolved.filter(requirement => listedSet.has(requirement.from))
    const unresolvedItems = unresolved.map(requirement => ({
      id: `requirement:${requirement.from}:${requirement.kind}:${requirement.capability}`,
      name: `${requirement.kind}:${requirement.capability}`,
      status: 'missing',
      evidence: `${requirement.from} has no registered provider`,
    }))
    const modules = new Map(catalog.modules.map(module => [module.id, module]))
    const items = listed.map(id => {
      const module = modules.get(id)
      const ready = module?.implementation === 'ready' && (module.runtime === 'active' || module.runtime === 'static')
      return {
        id,
        name: id,
        status: ready ? 'ready' : module ? `${module.implementation}/${module.runtime}` : 'missing',
        evidence: module ? `${module.classification}/${module.layer}` : 'not present in module catalog',
      }
    })
    items.push(...unresolvedItems)
    const moduleBlockers = items.filter(item => required.has(item.id) && item.status !== 'ready').map(item => item.id)
    const requirementBlockers = unresolved
      .filter(requirement => required.has(requirement.from))
      .map(requirement => `requirement:${requirement.from}:${requirement.kind}:${requirement.capability}`)
    const blockers = [...moduleBlockers, ...requirementBlockers]
    return {
      id: 'native-product', source: 'config/product-composition.json',
      state: blockers.length ? 'blocked' : 'ready', items, blockers,
      summary: {
        requiredModules: required.size,
        readyModules: required.size - moduleBlockers.length,
        unresolvedCapabilities: requirementBlockers.length,
      },
    }
  }
}
