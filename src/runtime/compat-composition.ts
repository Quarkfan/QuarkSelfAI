import { createAssistantApplication, type AssistantApplication } from '../bootstrap/application.js'
import type { RuntimeConfig } from '../config/runtime.js'
import { loadNativeCutoverReadiness } from '../config/feature-parity.js'
import { ControlOnlyRuntime } from '../platform/defaults.js'
import { createAssistantStore } from '../storage/factory.js'
import { createControlConsoleComponent } from '../web/component.js'
import { FileModuleCatalogProvider } from '../catalog/file-provider.js'
import { CompatRuntime, compatRuntimeComponent } from './compat.js'

/**
 * Temporary process composition while compatibility features still own live
 * traffic. Removing this module must not require changing the application
 * skeleton or any native feature plugin.
 */
export async function createConfiguredAssistantApplication(config: RuntimeConfig): Promise<AssistantApplication> {
  const runtime = config.runtime.mode === 'compat'
    ? new CompatRuntime(config.runtime.configPath, { workspaceRoots: config.execution.workspaceRoots })
    : new ControlOnlyRuntime()
  const store = await createAssistantStore(config)
  const readiness = { inspect: loadNativeCutoverReadiness }
  try {
    return await createAssistantApplication(config, { store }, {
      components: runtime instanceof CompatRuntime ? [compatRuntimeComponent(runtime)] : [],
      componentFactories: [({ kernelStatus }) => createControlConsoleComponent(
        store,
        config,
        runtime,
        kernelStatus,
        readiness,
        new FileModuleCatalogProvider(),
      )],
    })
  } catch (error) {
    await store.close()
    throw error
  }
}
