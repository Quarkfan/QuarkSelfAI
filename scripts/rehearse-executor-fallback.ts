import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { SequentialExecutorRouter, type SubagentDispatcher } from '../src/execution/router.js'
import { WorkspacePolicy } from '../src/execution/workspace-policy.js'

const actionId = 'quark-executor-rehearsal-20260822-v1'
const codexCli = process.env.CODEX_CLI ?? '/opt/homebrew/bin/codex'
const missingClaudeCli = join(tmpdir(), 'quark-missing-claude-20260822')
const expected = 'QUARK_EXECUTOR_FALLBACK_OK'

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

const directory = await mkdtemp(join(tmpdir(), 'quark-executor-rehearsal-'))
const output = join(directory, 'last-message.txt')
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
      const result = execute(codexCli, [
        'exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never', '--sandbox', 'read-only',
        '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="medium"',
        '--output-last-message', output,
        `Fixed synthetic rehearsal. Do not read files or call tools. Reply with exactly: ${expected}`,
      ], directory).then(async (): Promise<SubagentResult> => {
        timeline.push({ provider, event: 'finish', at: Date.now() })
        const final = (await readFile(output, 'utf8')).trim()
        return final === expected
          ? { stopReason: 'completed', output: [{ type: 'text', text: final }] }
          : { stopReason: 'error', diagnostic: 'Codex returned an unexpected fixed rehearsal response', output: [] }
      }, (error: unknown): SubagentResult => {
        timeline.push({ provider, event: 'finish', at: Date.now() })
        return { stopReason: 'error', diagnostic: error instanceof Error ? error.message : String(error), output: [] }
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
    syntheticOnly: true,
    externalWrites: 0,
  }, null, 2)}\n`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
