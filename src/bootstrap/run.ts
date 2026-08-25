import type { AssistantApplication } from './host.js'

/**
 * Stable process boundary shared by every product composition. It owns signal
 * handling and fatal component propagation, but knows nothing about channels,
 * storage providers, compatibility selectors, or product features.
 */
export async function runAssistantApplication(application: AssistantApplication): Promise<void> {
  await application.start()

  let stopping = false
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    process.stdout.write(`Assistant host stopping on ${signal}\n`)
    await application.stop()
  }

  void application.waitForFailure().then(async ({ componentId, error }) => {
    process.stderr.write(`Assistant component ${componentId} failed: ${error.message}\n`)
    await stop(`${componentId}-failure`).catch((stopError) => {
      process.stderr.write(`Assistant shutdown after component failure also failed: ${String(stopError)}\n`)
    })
    process.exitCode = 1
  })

  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))
}
