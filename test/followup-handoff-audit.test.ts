import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

test('followup handoff audit supplies the durable projection grant from compat configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-followup-audit-'))
  const statePath = join(directory, 'state.json')
  try {
    await writeFile(statePath, JSON.stringify({ followupLastCheckedDay: '2026-09-09', followupOutreachRequests: [] }))
    await writeFile(join(directory, 'config.json'), JSON.stringify({
      followupProjectId: 'synthetic-followup', followupTimeZone: 'Asia/Shanghai', followupScheduledHour: 10, followupPollIntervalMs: 3_600_000,
    }))
    const result = await runAudit(statePath)
    assert.equal(result.code, 0, result.stderr)
    const report = JSON.parse(result.stdout) as Record<string, unknown>
    assert.equal(report.mode, 'read-only')
    assert.equal(report.workflows, 1)
    assert.equal(report.reviewCheckpoint, 1)
    assert.match(String(report.projectIdHash), /^[a-f0-9]{16}$/)
    assert.match(String(report.digest), /^[a-f0-9]{64}$/)
    assert.equal(result.stdout.includes('synthetic-followup'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function runAudit(statePath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/audit-followup-handoff.ts'), `--state=${statePath}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []; const stderr: Buffer[] = []
    child.stdout.on('data', value => stdout.push(Buffer.from(value)))
    child.stderr.on('data', value => stderr.push(Buffer.from(value)))
    child.once('error', reject)
    child.once('close', code => accept({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
  })
}
