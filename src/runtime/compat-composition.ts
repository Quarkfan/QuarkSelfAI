import { createAssistantApplication, type AssistantApplication } from '../bootstrap/application.js'
import type { RuntimeConfig } from '../config/runtime.js'
import { loadNativeCutoverReadiness } from '../config/feature-parity.js'
import { ControlOnlyRuntime } from '../platform/defaults.js'
import { createAssistantStore } from '../storage/factory.js'
import { createControlConsoleComponent } from '../web/component.js'
import { FileModuleCatalogProvider } from '../catalog/file-provider.js'
import { CompatRuntime, compatRuntimeComponent } from './compat.js'
import { CompatStateWorkEvidenceProvider } from './compat-work-evidence.js'
import { AgentWorkJournalCompiler } from '../work-journal/agent-compiler.js'
import { WorkJournalService } from '../work-journal/service.js'
import { ReferenceProjectWorkEvidenceProvider } from '../work-journal/reference-project-evidence.js'
import { FeishuWorkEvidenceProvider } from '../work-journal/feishu-evidence.js'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

/**
 * Temporary process composition while compatibility features still own live
 * traffic. Removing this module must not require changing the application
 * skeleton or any native feature plugin.
 */
export async function createConfiguredAssistantApplication(config: RuntimeConfig): Promise<AssistantApplication> {
  const runtime = config.runtime.mode === 'compat'
    ? new CompatRuntime(config.runtime.configPath, { workspaceRoots: config.execution.workspaceRoots })
    : new ControlOnlyRuntime()
  const compatibilityConfig = config.runtime.mode === 'compat'
    ? JSON.parse(await readFile(config.runtime.configPath, 'utf8')) as Record<string, unknown>
    : {}
  const store = await createAssistantStore(config)
  const readiness = { inspect: loadNativeCutoverReadiness }
  const workJournalConfig = {
    ...config.workJournal,
    larkCli: typeof compatibilityConfig.larkCli === 'string' && compatibilityConfig.larkCli.trim()
      ? compatibilityConfig.larkCli.trim() : config.workJournal.larkCli,
    ownerOpenId: config.workJournal.ownerOpenId
      ?? (typeof compatibilityConfig.allowedOpenId === 'string' && compatibilityConfig.allowedOpenId.trim()
        ? compatibilityConfig.allowedOpenId.trim() : undefined),
  }
  const workJournal = config.runtime.mode === 'compat'
    ? new WorkJournalService(
        workJournalConfig,
        store,
        new FeishuWorkEvidenceProvider(
          new ReferenceProjectWorkEvidenceProvider(
            new CompatStateWorkEvidenceProvider(config.runtime.configPath), config.workJournal.workspace,
          ),
          workJournalConfig,
        ),
        new AgentWorkJournalCompiler(workJournalConfig, join(process.cwd(), 'var', 'work-journal-runs')),
      )
    : undefined
  try {
    return await createAssistantApplication(config, { store }, {
      components: [
        ...(runtime instanceof CompatRuntime ? [compatRuntimeComponent(runtime)] : []),
        ...(workJournal ? [workJournal.component()] : []),
      ],
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
