import { createAssistantApplication, type AssistantApplication } from '../bootstrap/application.js'
import { FileModuleCatalogProvider } from '../catalog/file-provider.js'
import { createAssistantStore } from '../storage/factory.js'
import { createControlConsoleComponent } from '../web/component.js'
import type { NativeProductConfig } from './config.js'
import type { ProductCompositionManifest } from './manifest.js'
import { NativeProductReadiness, NativeProductRuntimeStatus } from './status.js'

/** Long-term product composition. It contains no compatibility selector or legacy state path. */
export async function createNativeProductApplication(
  config: NativeProductConfig,
  manifest: ProductCompositionManifest,
): Promise<AssistantApplication> {
  const catalogProvider = new FileModuleCatalogProvider()
  const catalog = await catalogProvider.load()
  const storageModuleId = config.storage.kind === 'postgres' ? 'postgres-storage' : 'sqlite-storage'
  const readiness = new NativeProductReadiness(catalogProvider, manifest, storageModuleId)
  const report = await readiness.inspect()
  if (report.state !== 'ready') throw new Error(`native product modules are not ready: ${report.blockers.join(',')}`)
  const store = await createAssistantStore(config)
  try {
    return await createAssistantApplication(config, { store }, {
      componentFactories: [({ kernelStatus }) => createControlConsoleComponent(
        store,
        config,
        new NativeProductRuntimeStatus(kernelStatus, catalog, manifest, storageModuleId),
        kernelStatus,
        readiness,
        catalogProvider,
      )],
    })
  } catch (error) {
    await store.close()
    throw error
  }
}
