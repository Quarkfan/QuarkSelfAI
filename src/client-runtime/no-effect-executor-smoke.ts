import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { AuthProbeExecutorIdV1, AuthProbeResultV1 } from './executor-readiness-probe.js'
import type { BundledDshReportV1 } from './bundled-dsh-discovery.js'

const prompt = 'Reply with exactly QUARK_PILOT_OK. Do not use tools, inspect files, or perform any other action.'
const expected = 'QUARK_PILOT_OK'
type ExecutorId = AuthProbeExecutorIdV1 | 'dsh'
type SmokeObservation = { readonly exitCode: number | null; readonly timedOut: boolean; readonly output: string; readonly durationMs: number }
export interface FixedNoEffectSmokeRunnerV1 { run(executorId: ExecutorId, cwd: string): Promise<SmokeObservation> }

export interface NoEffectSmokeReceiptV1 {
  readonly schemaVersion: 1
  readonly executorId: ExecutorId
  readonly resultCode: 'synthetic-ok'
  readonly contentDigest: string
  readonly durationMs: number
  readonly attemptCount: 1
  readonly executorInvoked: true
  readonly toolsEnabled: false
  readonly workspaceDataRead: false
  readonly externalWritesEnabled: false
  readonly effectsActive: 0
  readonly currentOwnerPreserved: true
}

/** One fixed public prompt, one executor attempt, no tools and no continuation. Raw output is discarded. */
export async function runNoEffectExecutorSmoke(input: { readonly auth: readonly AuthProbeResultV1[]; readonly dsh: BundledDshReportV1; readonly cwd: string }, runner: FixedNoEffectSmokeRunnerV1 = new NodeFixedNoEffectSmokeRunnerV1()): Promise<NoEffectSmokeReceiptV1> {
  const ready = new Set<ExecutorId>(input.auth.filter(item => item.installation === 'detected' && item.authentication === 'ready').map(item => item.executorId))
  if (input.dsh.installation === 'detected' && input.dsh.authentication === 'ready') ready.add('dsh')
  const executorId = (['claude-code', 'codex', 'dsh'] as const).find(candidate => ready.has(candidate))
  if (!executorId) throw new Error('no authenticated executor is eligible for the no-effect smoke')
  const observation = await runner.run(executorId, input.cwd)
  if (observation.timedOut || observation.exitCode !== 0 || !Number.isSafeInteger(observation.durationMs) || observation.durationMs < 0) throw new Error('synthetic executor response failed')
  const answer = parseAnswer(executorId, observation.output)
  if (answer.trim() !== expected) throw new Error('synthetic executor response is invalid')
  return Object.freeze({ schemaVersion: 1, executorId, resultCode: 'synthetic-ok', contentDigest: `sha256:${createHash('sha256').update(expected).digest('hex')}`, durationMs: observation.durationMs,
    attemptCount: 1, executorInvoked: true, toolsEnabled: false, workspaceDataRead: false, externalWritesEnabled: false, effectsActive: 0, currentOwnerPreserved: true })
}

export class NodeFixedNoEffectSmokeRunnerV1 implements FixedNoEffectSmokeRunnerV1 {
  run(executorId: ExecutorId, cwd: string): Promise<SmokeObservation> {
    if (executorId === 'claude-code') return spawnFixed('claude', ['-p', prompt, '--output-format', 'json', '--permission-mode', 'dontAsk', '--tools', '', '--no-session-persistence'], cwd)
    if (executorId === 'codex') return spawnFixed('codex', ['exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', '--json', '-'], cwd, prompt)
    throw new Error('bundled DSH has no standalone no-tool smoke adapter')
  }
}

function parseAnswer(executorId: ExecutorId, output: string): string {
  if (output.length > 128 * 1024 || output.includes('\0')) throw new Error('synthetic executor output is not bounded')
  if (executorId === 'claude-code') {
    const value = JSON.parse(output) as Record<string, unknown>
    if (typeof value.result !== 'string') throw new Error('Claude synthetic output is malformed')
    return value.result
  }
  if (executorId === 'codex') {
    for (const line of output.trim().split('\n').reverse()) {
      try { const value = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } }; if (value.type === 'item.completed' && value.item?.type === 'agent_message' && typeof value.item.text === 'string') return value.item.text }
      catch { /* discard non-JSON noise */ }
    }
    throw new Error('Codex synthetic output is malformed')
  }
  throw new Error('bundled DSH synthetic output is unsupported')
}

function spawnFixed(command: string, args: readonly string[], cwd: string, stdin?: string): Promise<SmokeObservation> {
  return new Promise(resolve => {
    const started = Date.now(); let output = Buffer.alloc(0); let settled = false
    const child = spawn(command, [...args], { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    const append = (chunk: Buffer | string) => { if (output.byteLength < 128 * 1024) output = Buffer.concat([output, Buffer.from(chunk).subarray(0, 128 * 1024 - output.byteLength)]) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    const finish = (exitCode: number | null, timedOut: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ exitCode, timedOut, output: output.toString('utf8'), durationMs: Date.now() - started }) }
    child.once('error', () => finish(1, false)); child.once('close', code => finish(code ?? 1, false))
    child.stdin.end(stdin)
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(null, true) }, 60_000)
  })
}
