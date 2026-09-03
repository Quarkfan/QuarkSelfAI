import { createAssistantApplication, type AssistantApplication } from '../bootstrap/application.js'
import { FileModuleCatalogProvider } from '../catalog/file-provider.js'
import { createAssistantStore } from '../storage/factory.js'
import { createControlConsoleComponent } from '../web/component.js'
import type { NativeProductConfig } from './config.js'
import type { ProductCompositionManifest } from './manifest.js'
import { NativeProductReadiness, NativeProductRuntimeStatus } from './status.js'
import { AgentWorkJournalCompiler } from '../work-journal/agent-compiler.js'
import { NativeStoreWorkEvidenceProvider } from '../work-journal/native-evidence.js'
import { WorkJournalService } from '../work-journal/service.js'
import { ReferenceProjectWorkEvidenceProvider } from '../work-journal/reference-project-evidence.js'
import { join } from 'node:path'

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
  const workJournal = new WorkJournalService(
    config.workJournal,
    store,
    new ReferenceProjectWorkEvidenceProvider(new NativeStoreWorkEvidenceProvider(store), config.workJournal.workspace),
    new AgentWorkJournalCompiler(config.workJournal, join(process.cwd(), 'var', 'work-journal-runs')),
  )
  try {
    return await createAssistantApplication(config, { store }, {
      components: [workJournal.component()],
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
