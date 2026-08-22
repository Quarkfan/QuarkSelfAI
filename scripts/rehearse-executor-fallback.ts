import { execFile } from 'node:child_process'
import { mkdtemp, open, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { SequentialExecutorRouter, type SubagentDispatcher } from '../src/execution/router.js'
import { WorkspacePolicy } from '../src/execution/workspace-policy.js'

const actionId = 'quark-executor-rehearsal-20260822-v1'
const missingClaudeCli = join(tmpdir(), 'quark-missing-claude-20260822')
const expected = 'QUARK_CODEX_HANDOFF_READY'
const lockPath = join(tmpdir(), 'quark-executor-fallback-rehearsal.lock')

function failureClass(reason: string | undefined): string | undefined {
  if (!reason) return undefined
  if (/timed? out|timeout/i.test(reason)) return 'timeout'
  if (/network|connection|websocket|transport|dns|socket/i.test(reason)) return 'connection'
  if (/enoent|no such file/i.test(reason)) return 'process-start'
  if (/unexpected fixed rehearsal response/i.test(reason)) return 'unexpected-response'
  return 'other-infrastructure'
}

function execute(file: string, args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { cwd, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error(`${error.message}\n${stderr}`)
        ;(failure as NodeJS.ErrnoException).code = (error as NodeJS.ErrnoException).code
        reject(failure)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

try {
  const existingPid = Number((await readFile(lockPath, 'utf8')).trim())
  if (Number.isInteger(existingPid) && existingPid > 0) {
    try {
      process.kill(existingPid, 0)
      throw new Error(`executor fallback rehearsal is already active as pid ${existingPid}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  await unlink(lockPath)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const lock = await open(lockPath, 'wx', 0o600)
await lock.writeFile(`${process.pid}\n`)
const directory = await mkdtemp(join(tmpdir(), 'quark-executor-rehearsal-'))
const timeline: Array<{ provider: string; event: 'start' | 'finish'; at: number }> = []
try {
  const dispatcher: SubagentDispatcher = {
    async start(provider): Promise<SubagentRun> {
      timeline.push({ provider, event: 'start', at: Date.now() })
      if (provider === 'rehearsal-claude-read') {
        try {
          await execute(missingClaudeCli, ['--version'], directory)
        } finally {
          timeline.push({ provider, event: 'finish', at: Date.now() })
        }
        throw new Error('unreachable')
      }
      if (provider !== 'rehearsal-codex-read') throw new Error(`unexpected provider ${provider}`)
      const result = Promise.resolve().then(async (): Promise<SubagentResult> => {
        timeline.push({ provider, event: 'finish', at: Date.now() })
        return { stopReason: 'completed', output: [{ type: 'text', text: expected }] }
      })
      return { id: 'codex-rehearsal-run' as SubagentRun['id'], localAgent: undefined, result, async dispose() {} }
    },
  }
  const policy = await WorkspacePolicy.create([directory])
  const router = new SequentialExecutorRouter(dispatcher, policy, {
    'claude-code': { readOnly: 'rehearsal-claude-read', write: 'disabled' },
    codex: { readOnly: 'rehearsal-codex-read', write: 'disabled' },
    'dsh-native': { readOnly: 'disabled', write: 'disabled' },
  })
  const parent = { session: { header: { cwd: directory } } } as unknown as Agent
  const result = await router.execute({
    actionId,
    title: '固定合成执行器兜底演练',
    prompt: expected,
    workspace: directory,
    mode: 'read-only',
    requestedExecutor: 'claude-code',
    approvalGranted: true,
    parent,
  }, new AbortController().signal)
  const claudeFinished = timeline.find((entry) => entry.provider === 'rehearsal-claude-read' && entry.event === 'finish')?.at
  const codexStarted = timeline.find((entry) => entry.provider === 'rehearsal-codex-read' && entry.event === 'start')?.at
  const serial = claudeFinished !== undefined && codexStarted !== undefined && codexStarted >= claudeFinished
  if (result.status !== 'completed' || result.executor !== 'codex' || result.summary !== expected || !serial) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      actionId,
      requestedExecutor: 'claude-code',
      actualExecutor: result.executor,
      attempts: result.attempts.map((attempt) => ({
        executor: attempt.executor,
        provider: attempt.provider,
        status: attempt.status,
        failureStage: attempt.failureStage,
        failureClass: failureClass(attempt.failureReason),
      })),
      serialNoOverlap: serial,
      syntheticOnly: true,
      externalWrites: 0,
    }, null, 2)}\n`)
    throw new Error('executor fallback rehearsal did not meet its acceptance conditions')
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    actionId,
    requestedExecutor: 'claude-code',
    actualExecutor: result.executor,
    attempts: result.attempts,
    serialNoOverlap: serial,
    final: result.summary,
    realCodexPending: true,
    syntheticOnly: true,
    externalWrites: 0,
  }, null, 2)}\n`)
} finally {
  await rm(directory, { recursive: true, force: true })
  await lock.close()
  await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}
