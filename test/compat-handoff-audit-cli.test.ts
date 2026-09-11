import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const auditScripts = [
  'audit-collaboration-handoff.ts',
  'audit-dida-maintenance-handoff.ts',
  'audit-session-lifecycle-handoff.ts',
  'audit-xiaowei-research-handoff.ts',
  'audit-followup-handoff.ts',
  'audit-message-intake-handoff.ts',
]

test('all workflow handoff audits expose only bounded state and resource identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-handoff-audits-'))
  const statePath = join(directory, 'state.json')
  try {
    await writeFile(statePath, '{}')
    await writeFile(join(directory, 'config.json'), JSON.stringify({
      didaProjectId: 'private-dida-project',
      followupProjectId: 'private-followup-project',
      xiaoweiAgent: { name: 'private-agent-name', openId: 'private-agent-id', chatId: 'private-chat-id' },
    }))
    for (const script of auditScripts) {
      const result = await runAudit(script, statePath)
      assert.equal(result.code, 0, `${script}: ${result.stderr}`)
      const report = JSON.parse(result.stdout) as Record<string, unknown>
      assert.equal(report.mode, 'read-only', script)
      assert.match(String(report.statePathHash), /^[a-f0-9]{16}$/, script)
      for (const secret of [directory, 'private-dida-project', 'private-followup-project', 'private-agent-name', 'private-agent-id', 'private-chat-id']) {
        assert.equal(result.stdout.includes(secret), false, `${script} exposed ${secret}`)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function runAudit(script: string, statePath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts', script), `--state=${statePath}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []; const stderr: Buffer[] = []
    child.stdout.on('data', value => stdout.push(Buffer.from(value)))
    child.stderr.on('data', value => stderr.push(Buffer.from(value)))
    child.once('error', reject)
    child.once('close', code => accept({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
  })
}
