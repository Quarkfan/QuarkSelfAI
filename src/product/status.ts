import type { AssistantModuleCatalog, ModuleCatalogProvider } from '../platform/modules.js'
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
    const runtimeDependencies = runtimeDependencyClosure(this.catalog, requiredRoots)
      .filter(id => !requiredRoots.includes(id))
    capabilities.push(this.capability('platform-runtime-dependencies', true, runtimeDependencies, kernel.state))
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
    const listed = [...new Set([...roots, ...runtimeDependencyClosure(catalog, roots)])]
    const required = new Set(runtimeDependencyClosure(catalog, requiredRoots))
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
    const blockers = items.filter(item => required.has(item.id) && item.status !== 'ready').map(item => item.id)
    return {
      id: 'native-product', source: 'config/product-composition.json',
      state: blockers.length ? 'blocked' : 'ready', items, blockers,
      summary: { requiredModules: required.size, readyModules: required.size - blockers.length },
    }
  }
}

/** Resolve provider/runtime ownership transitively without treating source imports as live services. */
function runtimeDependencyClosure(catalog: AssistantModuleCatalog, roots: readonly string[]): string[] {
  const modules = new Map(catalog.modules.map(module => [module.id, module]))
  const closure = new Set<string>()
  const pending = [...roots]
  while (pending.length) {
    const id = pending.shift()!
    if (closure.has(id)) continue
    closure.add(id)
    for (const dependency of modules.get(id)?.runtimeDependsOn ?? []) pending.push(dependency)
  }
  return [...closure]
}
