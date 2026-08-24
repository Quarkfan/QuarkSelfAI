import { loadRuntimeConfig } from './config/runtime.js'
import { createAssistantApplication } from './bootstrap/application.js'

const config = loadRuntimeConfig()
const application = await createAssistantApplication(config)
await application.start()

let stopping = false
async function stop(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  process.stdout.write(`QuarkSelfAI stopping on ${signal}\n`)
  await application.stop()
}

void application.waitForFailure().then(async ({ componentId, error }) => {
  process.stderr.write(`QuarkSelfAI component ${componentId} failed: ${error.message}\n`)
  await stop(`${componentId}-failure`).catch((stopError) => {
    process.stderr.write(`QuarkSelfAI shutdown after component failure also failed: ${String(stopError)}\n`)
  })
  process.exitCode = 1
})

process.once('SIGINT', () => void stop('SIGINT'))
process.once('SIGTERM', () => void stop('SIGTERM'))
