import { spawn } from 'node:child_process'

const maxOutputBytes = 4_096
const timeoutMs = 5_000
const commands = Object.freeze({
  'claude-code': Object.freeze({ command: 'claude', args: Object.freeze(['--version']) }),
  codex: Object.freeze({ command: 'codex', args: Object.freeze(['--version']) }),
  dsh: Object.freeze({ command: 'dsh', args: Object.freeze(['--version']) }),
})
export type HostProbeExecutorIdV1 = keyof typeof commands

export interface HostProbeObservationV1 {
  readonly state: 'completed' | 'not-found' | 'timed-out'
  readonly exitCode: number | null
  readonly output: string
  readonly authentication: 'unknown'
}

export interface FixedProcessProbeRunnerV1 {
  run(executorId: HostProbeExecutorIdV1): Promise<HostProbeObservationV1>
}

/**
 * The only executable host adapter in pilot 01. It never uses a shell, accepts
 * no caller-supplied command, and discards bounded output after classification.
 */
export class NodeFixedProcessProbeRunnerV1 implements FixedProcessProbeRunnerV1 {
  run(executorId: HostProbeExecutorIdV1): Promise<HostProbeObservationV1> {
    const spec = commands[executorId]
    if (!spec) throw new Error('host process probe must match the fixed allowlist')
    return new Promise(resolve => {
      let output = Buffer.alloc(0)
      let settled = false
      const child = spawn(spec.command, [...spec.args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      const append = (chunk: Buffer | string) => {
        if (output.byteLength >= maxOutputBytes) return
        output = Buffer.concat([output, Buffer.from(chunk).subarray(0, maxOutputBytes - output.byteLength)])
      }
      child.stdout.on('data', append)
      child.stderr.on('data', append)
      const finish = (observation: HostProbeObservationV1) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(observation)
      }
      child.once('error', error => finish({
        state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'completed',
        exitCode: (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 1,
        output: output.toString('utf8'),
        authentication: 'unknown',
      }))
      child.once('close', code => finish({ state: 'completed', exitCode: code ?? 1, output: output.toString('utf8'), authentication: 'unknown' }))
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish({ state: 'timed-out', exitCode: null, output: '', authentication: 'unknown' })
      }, timeoutMs)
      timer.unref()
    })
  }
}

export async function inspectAllowlistedHostExecutors(
  runner: FixedProcessProbeRunnerV1 = new NodeFixedProcessProbeRunnerV1(),
): Promise<Readonly<Record<HostProbeExecutorIdV1, HostProbeObservationV1>>> {
  const observations = {} as Record<HostProbeExecutorIdV1, HostProbeObservationV1>
  for (const executorId of Object.keys(commands) as HostProbeExecutorIdV1[]) {
    observations[executorId] = await runner.run(executorId)
  }
  return Object.freeze(observations)
}
