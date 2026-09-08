import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileCapabilityEvolutionProvider } from '../src/capability-evolution/provider.js'

test('reads the Codex automation and a privacy-bounded evolution ledger without exposing its prompt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-evolution-'))
  const automationPath = join(directory, 'automation.toml')
  const statusPath = join(directory, 'status.json')
  await writeFile(automationPath, `version = 1\nid = "quarkselfai"\nkind = "cron"\nname = "QuarkSelfAI 能力进化巡检"\nprompt = "secret business context"\nstatus = "ACTIVE"\nrrule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=30"\nmodel = "gpt-5.6-sol"\nreasoning_effort = "medium"\ntarget = { type = "project", project_id = "local-project" }\n`)
  await writeFile(statusPath, JSON.stringify({ version: 1, latestRun: { title: '能力进化｜2026-09-02｜能力巡检', track: 'measurable-enhancement', startedAt: '2026-09-02T06:30:00.000Z', completedAt: '2026-09-02T06:42:00.000Z', outcome: 'upgraded', summary: '新增一个低风险 Skill。', taskId: 'thread-1' }, history: [
    { title: '能力进化｜2026-09-02｜能力巡检', track: 'measurable-enhancement', startedAt: '2026-09-02T06:30:00.000Z', outcome: 'upgraded', summary: '新增一个低风险 Skill。' },
    ...Array.from({ length: 4 }, (_, index) => ({ title: `能力进化｜2026-09-0${index + 1}｜可靠性`, track: 'reliability', startedAt: `2026-09-0${index + 1}T06:30:00.000Z`, outcome: 'upgraded', summary: '修复一个运行故障。' })),
  ], reports: [{ title: '新增日志检索 Skill', track: 'measurable-enhancement', summary: '减少重复排障检索。', recordedAt: '2026-09-02T06:42:00.000Z', outcome: 'upgraded', commit: 'abc123' }] }))
  try {
    const result = await new FileCapabilityEvolutionProvider({ automationPath, statusPath }).inspect()
    assert.equal(result.state, 'active')
    assert.equal(result.mode, 'cron')
    assert.equal(result.scheduleLabel, '每个工作日 14:30')
    assert.equal(result.workspace, 'local-project')
    assert.equal(result.latestRun?.taskId, 'thread-1')
    assert.equal(result.latestRun?.track, 'measurable-enhancement')
    assert.deepEqual(result.trajectory, { windowSize: 5, trackedRuns: 5, distinctTracks: 2, state: 'balanced', counts: { reliability: 4, 'measurable-enhancement': 1, 'strategic-opportunity': 0 }, nextTrackPreference: 'strategic-opportunity' })
    assert.equal(result.reports[0]?.track, 'measurable-enhancement')
    assert.equal(result.reports[0]?.commit, 'abc123')
    assert.equal(JSON.stringify(result).includes('secret business context'), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('degrades to a visible missing state when the local Codex automation is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-evolution-missing-'))
  try {
    const result = await new FileCapabilityEvolutionProvider({ automationPath: join(directory, 'missing.toml'), statusPath: join(directory, 'missing.json') }).inspect()
    assert.equal(result.configured, false)
    assert.equal(result.state, 'missing')
    assert.equal(result.trajectory.state, 'insufficient-data')
    assert.deepEqual(result.reports, [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('makes a single-track five-run window visible instead of treating rotation as prose', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-evolution-skewed-'))
  const automationPath = join(directory, 'automation.toml')
  const statusPath = join(directory, 'status.json')
  await writeFile(automationPath, 'version = 1\nid = "quarkselfai"\nkind = "cron"\nname = "巡检"\nstatus = "ACTIVE"\n')
  await writeFile(statusPath, JSON.stringify({ version: 1, latestRun: { title: '可靠性', track: 'reliability', startedAt: '2026-09-05T00:00:00.000Z', outcome: 'upgraded', summary: '修复' }, history: Array.from({ length: 5 }, (_, index) => ({ title: `可靠性 ${index}`, track: 'reliability', startedAt: `2026-09-0${index + 1}T00:00:00.000Z`, outcome: 'upgraded', summary: '修复' })), reports: [] }))
  try {
    const result = await new FileCapabilityEvolutionProvider({ automationPath, statusPath }).inspect()
    assert.deepEqual(result.trajectory, { windowSize: 5, trackedRuns: 5, distinctTracks: 1, state: 'skewed', counts: { reliability: 5, 'measurable-enhancement': 0, 'strategic-opportunity': 0 }, nextTrackPreference: 'measurable-enhancement' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
