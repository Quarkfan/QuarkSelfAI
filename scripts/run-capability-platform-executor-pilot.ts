import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { discoverBundledDsh } from '../src/client-runtime/bundled-dsh-discovery.js'
import { inspectExecutorReadiness } from '../src/client-runtime/executor-readiness-probe.js'
import { runNoEffectExecutorSmoke } from '../src/client-runtime/no-effect-executor-smoke.js'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)

export async function runCapabilityPlatformExecutorPilot(now = new Date()) {
  const workspace = await mkdtemp(join(tmpdir(), 'quark-executor-pilot-'))
  try {
    const auth = await inspectExecutorReadiness(workspace, now)
    const dsh = await discoverBundledDsh(projectRoot)
    const smoke = await runNoEffectExecutorSmoke({ auth, dsh, cwd: workspace })
    return Object.freeze({ schemaVersion: 1, requestId: 'capability-platform-executor-runtime-pilot-02',
      readiness: Object.freeze([...auth.map(item => Object.freeze({ executorId: item.executorId, installation: item.installation, authentication: item.authentication })), Object.freeze({ executorId: dsh.executorId, installation: dsh.installation, authentication: dsh.authentication, version: dsh.version, inferenceConfigured: dsh.inferenceConfigured })]),
      smoke, temporaryWorkspaceRemoved: true, runtimeCompositionChanged: false, serviceRestarted: false })
  } finally { await rm(workspace, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCapabilityPlatformExecutorPilot().then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`), error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
