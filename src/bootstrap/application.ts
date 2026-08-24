import { once } from 'node:events'
import type { Server } from 'node:http'
import type { RuntimeConfig } from '../config/runtime.js'
import { createAssistantStore } from '../storage/factory.js'
import { createConsoleServer } from '../web/server.js'
import { CompatRuntime } from '../runtime/compat.js'
import { DisabledKernelRuntime, DshKernelRuntime } from '../runtime/kernel.js'
import type { ManagedComponent } from '../platform/lifecycle.js'
import { ControlOnlyRuntime } from '../platform/operations.js'
import { loadFeatureParity } from '../config/feature-parity.js'
import { createAssistantApplicationHost, type AssistantApplication } from './host.js'

export type { AssistantApplication } from './host.js'

export async function createAssistantApplication(config: RuntimeConfig): Promise<AssistantApplication> {
  const store = await createAssistantStore(config)
  const runtime = config.runtime.mode === 'compat'
    ? new CompatRuntime(config.runtime.configPath, { workspaceRoots: config.execution.workspaceRoots })
    : new ControlOnlyRuntime()
  const kernel = config.kernel.mode === 'dsh' ? new DshKernelRuntime(config.kernel) : new DisabledKernelRuntime()
  const server = createConsoleServer(store, config, runtime, kernel, { inspect: loadFeatureParity })
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
  if (runtime instanceof CompatRuntime) {
    components.push({
      id: 'bridge-compat',
      kind: 'migration',
      start: async () => {
        await runtime.start()
        await runtime.waitUntilReady()
        process.stdout.write('QuarkSelfAI compatibility runtime ready\n')
      },
      stop: async () => { await runtime.stop() },
      waitForFailure: async () => await runtime.waitForFailure(),
    })
  }
  return createAssistantApplicationHost(components)
}

function consoleComponent(server: Server, config: RuntimeConfig, storage: string): ManagedComponent {
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
