import { once } from 'node:events'
import { loadRuntimeConfig } from './config/runtime.js'
import { createAssistantStore } from './storage/factory.js'
import { createConsoleServer } from './web/server.js'
import { CompatRuntime, ControlOnlyRuntime } from './runtime/compat.js'
import { DisabledKernelRuntime, DshKernelRuntime } from './runtime/kernel.js'

const config = loadRuntimeConfig()
const store = await createAssistantStore(config)
await store.health()
const runtime = config.runtime.mode === 'compat'
  ? new CompatRuntime(config.runtime.configPath, { workspaceRoots: config.execution.workspaceRoots })
  : new ControlOnlyRuntime()
const kernel = config.kernel.mode === 'dsh' ? new DshKernelRuntime(config.kernel) : new DisabledKernelRuntime()
if (kernel instanceof DshKernelRuntime) {
  try {
    await kernel.start()
  } catch (error) {
    await kernel.stop().catch(() => undefined)
    await store.close()
    throw error
  }
  process.stdout.write(`QuarkSelfAI DSH kernel ready profile=${kernel.snapshot().profile ?? 'unknown'}\n`)
}
const server = createConsoleServer(store, config, runtime, kernel)

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
if (kernel instanceof DshKernelRuntime) {
  void kernel.waitForFailure().then(async (error) => {
    process.stderr.write(`QuarkSelfAI DSH kernel failed: ${error.message}\n`)
    await stop('dsh-kernel-failure').catch((stopError) => {
      process.stderr.write(`QuarkSelfAI shutdown after DSH failure also failed: ${String(stopError)}\n`)
    })
    process.exitCode = 1
  })
}

let stopping = false
async function stop(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  process.stdout.write(`QuarkSelfAI stopping on ${signal}\n`)
  if (runtime instanceof CompatRuntime) await runtime.stop()
  if (kernel instanceof DshKernelRuntime) await kernel.stop()
  server.close()
  await once(server, 'close')
  await store.close()
}

process.once('SIGINT', () => void stop('SIGINT'))
process.once('SIGTERM', () => void stop('SIGTERM'))
