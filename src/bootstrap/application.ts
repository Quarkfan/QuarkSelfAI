import { once } from 'node:events'
import type { Server } from 'node:http'
import type { ConsoleStorePort, StorageLifecyclePort } from '../storage/types.js'
import { createConsoleServer } from '../web/server.js'
import { DisabledKernelRuntime, DshKernelRuntime } from '../runtime/kernel.js'
import type { ManagedComponent } from '../platform/lifecycle.js'
import {
  ControlOnlyRuntime, UnconfiguredReadiness,
  type OperationalReadinessProvider, type RuntimeStatusProvider,
} from '../platform/operations.js'
import { createAssistantApplicationHost, type AssistantApplication } from './host.js'
import type { AssistantApplicationConfig } from './config.js'

export type { AssistantApplication } from './host.js'
export type { AssistantApplicationConfig } from './config.js'

export interface AssistantApplicationExtensions {
  readonly runtimeStatus?: RuntimeStatusProvider
  readonly readiness?: OperationalReadinessProvider
  readonly components?: readonly ManagedComponent[]
}

export interface AssistantApplicationInfrastructure {
  readonly store: ConsoleStorePort & Pick<StorageLifecyclePort, 'close'>
}

/**
 * Native composition root for stable infrastructure. Feature and migration
 * hosts contribute managed components without becoming dependencies of the
 * application skeleton.
 */
export async function createAssistantApplication(
  config: AssistantApplicationConfig,
  infrastructure: AssistantApplicationInfrastructure,
  extensions: AssistantApplicationExtensions = {},
): Promise<AssistantApplication> {
  const store = infrastructure.store
  const runtime = extensions.runtimeStatus ?? new ControlOnlyRuntime()
  const readiness = extensions.readiness ?? new UnconfiguredReadiness()
  const kernel = config.kernel.mode === 'dsh' ? new DshKernelRuntime(config.kernel) : new DisabledKernelRuntime()
  const server = createConsoleServer(store, config, runtime, kernel, readiness)
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
        process.stdout.write(`QuarkSelfAI DSH kernel ready profile=${kernel.snapshot().profile ?? 'unknown'}\n`)
      },
      stop: async () => { await kernel.stop() },
      waitForFailure: async () => await kernel.waitForFailure(),
    })
  }
  components.push(consoleComponent(server, config, store.kind))
  components.push(...(extensions.components ?? []))
  return createAssistantApplicationHost(components)
}

function consoleComponent(server: Server, config: AssistantApplicationConfig, storage: string): ManagedComponent {
  return {
    id: 'control-console',
    kind: 'surface',
    start: async () => {
      server.listen(config.web.port, config.web.host)
      await once(server, 'listening')
      process.stdout.write(`QuarkSelfAI console ready at http://${config.web.host}:${config.web.port} storage=${storage}\n`)
    },
    stop: async () => {
      if (!server.listening) return
      server.close()
      await once(server, 'close')
    },
  }
}
