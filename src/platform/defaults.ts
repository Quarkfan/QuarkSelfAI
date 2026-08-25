import type { AssistantModuleCatalog, ModuleCatalogProvider } from './modules.js'
import type {
  KernelSnapshot,
  KernelStatusProvider,
  OperationalReadinessProvider,
  OperationalReadinessReport,
  RuntimeSnapshot,
  RuntimeStatusProvider,
} from './operations.js'

/** Neutral module source for hosts that intentionally mount no product catalog. */
export class EmptyModuleCatalogProvider implements ModuleCatalogProvider {
  async load(): Promise<AssistantModuleCatalog> { return { version: 3, modules: [] } }
}

/** Neutral runtime source for control-only diagnostics with no consumer owner. */
export class ControlOnlyRuntime implements RuntimeStatusProvider {
  snapshot(): RuntimeSnapshot {
    return {
      mode: 'control-only', operationalMode: 'control-only', requiredForHealth: false,
      state: 'stopped', capabilities: [],
    }
  }
}

export class ControlOnlyKernel implements KernelStatusProvider {
  snapshot(): KernelSnapshot { return { mode: 'off', state: 'stopped' } }
}

export class UnconfiguredReadiness implements OperationalReadinessProvider {
  async inspect(): Promise<OperationalReadinessReport> {
    return {
      id: 'unconfigured', source: 'unconfigured', state: 'unknown', items: [],
      blockers: ['readiness-provider-unconfigured'], summary: {},
    }
  }
}
