import { spawn } from 'node:child_process'

export type AuthProbeExecutorIdV1 = 'claude-code' | 'codex'
export type AuthReadinessV1 = 'ready' | 'required' | 'unknown'

export interface AuthProbeResultV1 {
  readonly executorId: AuthProbeExecutorIdV1
  readonly installation: 'detected' | 'not-detected'
  readonly authentication: AuthReadinessV1
  readonly checkedAt: string
}

type Observation = { readonly state: 'completed' | 'not-found' | 'timed-out'; readonly exitCode: number | null; readonly output: string }
export interface FixedAuthProbeRunnerV1 { run(executorId: AuthProbeExecutorIdV1, cwd: string): Promise<Observation> }

const commands = Object.freeze({
  'claude-code': Object.freeze({ command: 'claude', args: Object.freeze(['auth', 'status', '--json']) }),
  codex: Object.freeze({ command: 'codex', args: Object.freeze(['login', 'status']) }),
})

/** Fixed read-only authentication probes. Raw output is classified in memory and never returned. */
export class NodeFixedAuthProbeRunnerV1 implements FixedAuthProbeRunnerV1 {
  run(executorId: AuthProbeExecutorIdV1, cwd: string): Promise<Observation> {
    const spec = commands[executorId]
    if (!spec) throw new Error('authentication probe must match the fixed allowlist')
    return boundedSpawn(spec.command, spec.args, cwd)
  }
}

export async function inspectExecutorReadiness(cwd: string, now = new Date(), runner: FixedAuthProbeRunnerV1 = new NodeFixedAuthProbeRunnerV1()): Promise<readonly AuthProbeResultV1[]> {
  if (!cwd || Number.isNaN(now.getTime())) throw new Error('authentication probe scope is invalid')
  const results: AuthProbeResultV1[] = []
  for (const executorId of Object.keys(commands) as AuthProbeExecutorIdV1[]) {
    const observation = await runner.run(executorId, cwd)
    results.push(Object.freeze({ executorId, installation: observation.state === 'not-found' ? 'not-detected' : 'detected', authentication: classify(executorId, observation), checkedAt: now.toISOString() }))
  }
  return Object.freeze(results)
}

function classify(executorId: AuthProbeExecutorIdV1, observation: Observation): AuthReadinessV1 {
  if (observation.state !== 'completed') return 'unknown'
  if (executorId === 'claude-code') {
    try {
      const value = JSON.parse(observation.output) as Record<string, unknown>
      if (value.loggedIn === true) return 'ready'
      if (value.loggedIn === false) return 'required'
    } catch { return 'unknown' }
    return 'unknown'
  }
  const normalized = observation.output.trim().toLowerCase()
  if (observation.exitCode === 0 && /logged in|authenticated/.test(normalized) && !/not logged in|not authenticated/.test(normalized)) return 'ready'
  if (/not logged in|login required|not authenticated/.test(normalized)) return 'required'
  return 'unknown'
}

function boundedSpawn(command: string, args: readonly string[], cwd: string): Promise<Observation> {
  return new Promise(resolve => {
    let output = Buffer.alloc(0)
    let settled = false
    const child = spawn(command, [...args], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const append = (chunk: Buffer | string) => { if (output.byteLength < 8_192) output = Buffer.concat([output, Buffer.from(chunk).subarray(0, 8_192 - output.byteLength)]) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    const finish = (value: Observation) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value) }
    child.once('error', error => finish({ state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'completed', exitCode: (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 1, output: output.toString('utf8') }))
    child.once('close', code => finish({ state: 'completed', exitCode: code ?? 1, output: output.toString('utf8') }))
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ state: 'timed-out', exitCode: null, output: '' }) }, 10_000)
    timer.unref()
  })
}
