import { once } from 'node:events'
import { loadRuntimeConfig } from './config/runtime.js'
import { createAssistantStore } from './storage/factory.js'
import { createConsoleServer } from './web/server.js'

const config = loadRuntimeConfig()
const store = await createAssistantStore(config)
await store.health()
const server = createConsoleServer(store, config)

server.listen(config.web.port, config.web.host)
await once(server, 'listening')
process.stdout.write(`QuarkSelfAI console ready at http://${config.web.host}:${config.web.port} storage=${store.kind}\n`)

let stopping = false
async function stop(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  process.stdout.write(`QuarkSelfAI stopping on ${signal}\n`)
  server.close()
  await once(server, 'close')
  await store.close()
}

process.once('SIGINT', () => void stop('SIGINT'))
process.once('SIGTERM', () => void stop('SIGTERM'))
