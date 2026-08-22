import { once } from 'node:events'
import { loadRuntimeConfig } from './config/runtime.js'
import { createAssistantStore } from './storage/factory.js'
import { createConsoleServer } from './web/server.js'
import { CompatRuntime, ControlOnlyRuntime } from './runtime/compat.js'

const config = loadRuntimeConfig()
const store = await createAssistantStore(config)
await store.health()
const runtime = config.runtime.mode === 'compat'
  ? new CompatRuntime(config.runtime.configPath, { workspaceRoots: config.execution.workspaceRoots })
  : new ControlOnlyRuntime()
const server = createConsoleServer(store, config, runtime)

server.listen(config.web.port, config.web.host)
await once(server, 'listening')
process.stdout.write(`QuarkSelfAI console ready at http://${config.web.host}:${config.web.port} storage=${store.kind}\n`)
if (runtime instanceof CompatRuntime) {
  try {
    await runtime.start()
    await runtime.waitUntilReady()
    process.stdout.write('QuarkSelfAI compatibility runtime ready\n')
    void runtime.waitForFailure().then(async (error) => {
      process.stderr.write(`QuarkSelfAI compatibility runtime failed: ${error.message}\n`)
      await stop('compat-runtime-failure').catch((stopError) => {
        process.stderr.write(`QuarkSelfAI shutdown after compatibility failure also failed: ${String(stopError)}\n`)
      })
      process.exitCode = 1
    })
  } catch (error) {
    await runtime.stop().catch(() => undefined)
    server.close()
    await once(server, 'close')
    await store.close()
    throw error
  }
}

let stopping = false
async function stop(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  process.stdout.write(`QuarkSelfAI stopping on ${signal}\n`)
  if (runtime instanceof CompatRuntime) await runtime.stop()
  server.close()
  await once(server, 'close')
  await store.close()
}

process.once('SIGINT', () => void stop('SIGINT'))
process.once('SIGTERM', () => void stop('SIGTERM'))
