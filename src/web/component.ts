import { once } from 'node:events'
import type { ManagedComponent } from '../platform/lifecycle.js'
import type {
  KernelStatusProvider, OperationalReadinessProvider, RuntimeStatusProvider,
} from '../platform/operations.js'
import type { ModuleCatalogProvider } from '../platform/modules.js'
import type { ConsoleStorePort } from '../storage/types.js'
import type { ConsoleServerConfig } from './config.js'
import { createConsoleServer } from './server.js'

export function createControlConsoleComponent(
  store: ConsoleStorePort,
  config: ConsoleServerConfig,
  runtime: RuntimeStatusProvider,
  kernel: KernelStatusProvider,
  readiness: OperationalReadinessProvider,
  catalog: ModuleCatalogProvider,
): ManagedComponent {
  const server = createConsoleServer(store, config, runtime, kernel, readiness, catalog)
  return {
    id: 'control-console',
    kind: 'surface',
    start: async () => {
      server.listen(config.web.port, config.web.host)
      await once(server, 'listening')
      process.stdout.write(`QuarkSelfAI console ready at http://${config.web.host}:${config.web.port} storage=${store.kind}\n`)
    },
    stop: async () => {
      if (!server.listening) return
      server.close()
      await once(server, 'close')
    },
  }
}
