import type { StorageLifecyclePort } from '../storage/types.js'
import { DisabledKernelRuntime, DshKernelRuntime } from '../runtime/kernel.js'
import type { ManagedComponent } from '../platform/lifecycle.js'
import type { KernelStatusProvider } from '../platform/operations.js'
import type { AssistantKernelConfig } from '../runtime/kernel-config.js'
import { createAssistantApplicationHost, type AssistantApplication } from './host.js'

export type { AssistantApplication } from './host.js'
export type { AssistantKernelConfig } from '../runtime/kernel-config.js'

export interface AssistantApplicationExtensions {
  readonly components?: readonly ManagedComponent[]
  readonly componentFactories?: readonly AssistantComponentFactory[]
}

export interface AssistantApplicationInfrastructure {
  readonly store: Pick<StorageLifecyclePort, 'kind' | 'health' | 'close'>
}

export interface AssistantComponentFactoryContext {
  readonly kernelStatus: KernelStatusProvider
}

export type AssistantComponentFactory = (context: AssistantComponentFactoryContext) => ManagedComponent

/**
 * Native composition root for stable infrastructure. Feature and migration
 * hosts contribute managed components without becoming dependencies of the
 * application skeleton.
 */
export async function createAssistantApplication(
  config: AssistantKernelConfig,
  infrastructure: AssistantApplicationInfrastructure,
  extensions: AssistantApplicationExtensions = {},
): Promise<AssistantApplication> {
  const store = infrastructure.store
  const kernel = config.kernel.mode === 'dsh' ? new DshKernelRuntime(config.kernel) : new DisabledKernelRuntime()
  const components: ManagedComponent[] = [
    {
      id: 'assistant-store',
      kind: 'infrastructure',
      async start() { await store.health() },
      async stop() { await store.close() },
    },
  ]
  if (kernel instanceof DshKernelRuntime) {
    components.push({
      id: 'dsh-kernel',
      kind: 'kernel',
      start: async () => {
        await kernel.start()
        process.stdout.write(`DSH kernel ready profile=${kernel.snapshot().profile ?? 'unknown'}\n`)
      },
      stop: async () => { await kernel.stop() },
      waitForFailure: async () => await kernel.waitForFailure(),
    })
  }
  components.push(...(extensions.componentFactories ?? []).map(factory => factory({ kernelStatus: kernel })))
  components.push(...(extensions.components ?? []))
  return createAssistantApplicationHost(components)
}
