import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { recoverInactiveClientInstallation } from './client-installation.js'
import { InstalledNoEffectClientProcessV1 } from './installed-client-process.js'
import type { NoEffectClientWorkerConfigV1 } from './no-effect-client-worker.js'

interface ClientEntryCommandV1 { readonly mode: 'status' | 'run'; readonly installRoot: string; readonly worker?: NoEffectClientWorkerConfigV1 }

export function compileClientEntryCommand(argv: readonly string[], environment: NodeJS.ProcessEnv): ClientEntryCommandV1 {
  if (argv.length !== 1 || !['status', 'run'].includes(argv[0] ?? '')) throw new Error('client command must be exactly status or run')
  const installRoot = environment.QUARK_CLIENT_INSTALL_ROOT
  if (!installRoot) throw new Error('client install root is required')
  if (argv[0] === 'status') return Object.freeze({ mode: 'status', installRoot })
  if (environment.QUARK_CLIENT_ENABLE_NO_EFFECT_WORKER !== '1') throw new Error('client worker is not explicitly enabled')
  const workspacePath = environment.QUARK_CLIENT_WORKSPACE
  if (!workspacePath) throw new Error('client workspace is required')
  const cycleIntervalMs = exactInteger(environment.QUARK_CLIENT_CYCLE_INTERVAL_MS ?? '30000')
  const discoveryIntervalMs = exactInteger(environment.QUARK_CLIENT_DISCOVERY_INTERVAL_MS ?? '300000')
  return Object.freeze({ mode: 'run', installRoot, worker: Object.freeze({ schemaVersion: 1, enabled: true, workspacePath, cycleIntervalMs, discoveryIntervalMs, externalWritesEnabled: false }) })
}

export async function runClientEntry(argv = process.argv.slice(2), environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const command = compileClientEntryCommand(argv, environment)
  if (command.mode === 'status') {
    const installation = await recoverInactiveClientInstallation(command.installRoot)
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: installation.receipt.installationId, clientVersion: installation.receipt.clientVersion, state: installation.receipt.state, autoStart: false, externalWritesEnabled: false })}\n`)
    return
  }
  const owner = await InstalledNoEffectClientProcessV1.open(command.installRoot, command.worker!)
  let stopping = false
  await new Promise<void>((resolveRun, rejectRun) => {
    const stop = (): void => {
      if (stopping) return
      stopping = true
      void owner.close().then(resolveRun, rejectRun)
    }
    process.once('SIGTERM', stop); process.once('SIGINT', stop)
    try { owner.start() } catch (error) { process.off('SIGTERM', stop); process.off('SIGINT', stop); void owner.close().then(() => rejectRun(error), rejectRun) }
  })
}

function exactInteger(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error('client interval is invalid')
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error('client interval is invalid')
  return result
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runClientEntry().catch(() => { process.stderr.write('Client failed: startup-or-runtime-failure\n'); process.exitCode = 1 })
}
