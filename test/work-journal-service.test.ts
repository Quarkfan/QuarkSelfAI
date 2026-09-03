import assert from 'node:assert/strict'
import test from 'node:test'
import type { DurableSignalInput } from '../src/storage/types.js'
import { WorkJournalService, targetWorkJournalDay } from '../src/work-journal/service.js'

test('selects the previous Shanghai day after close hour and catches up one day at a time', () => {
  assert.equal(targetWorkJournalDay({}, new Date('2026-09-03T00:00:00.000Z'), 5), '2026-09-02')
  assert.equal(targetWorkJournalDay({ lastClosedDay: '2026-08-30' }, new Date('2026-09-03T00:00:00.000Z'), 5), '2026-08-31')
  assert.equal(targetWorkJournalDay({ lastClosedDay: '2026-09-02' }, new Date('2026-09-03T00:00:00.000Z'), 5), undefined)
  assert.equal(targetWorkJournalDay({}, new Date('2026-09-02T20:00:00.000Z'), 5), undefined)
})

test('persists one immutable daily signal and a durable close checkpoint', async () => {
  let checkpoint: Readonly<Record<string, unknown>> | undefined
  const signals: DurableSignalInput[] = []
  const store = {
    async readFeatureCheckpoint() { return checkpoint },
    async writeFeatureCheckpoint(_namespace: string, _key: string, value: Readonly<Record<string, unknown>>) { checkpoint = value },
    async appendSignal(input: DurableSignalInput) { signals.push(input); return { inserted: true } },
    async recentSignals() { return signals.map((signal, index) => ({ ...signal, recordedAt: new Date(index).toISOString() })) },
  }
  const service = new WorkJournalService({
    enabled: true, timeZone: 'Asia/Shanghai', closeHour: 5, pollIntervalMs: 3_600_000,
    modelTimeoutMs: 60_000, workspace: '/tmp', claudeCli: 'claude', codexCli: 'codex',
  }, store, { async load(day) { return { day, matters: 1 } } }, {
    async compile(day) {
      return { version: 1, day, headline: '完成当日工作', highlights: [], decisions: [], deliverables: [], collaboration: [], nextSteps: [], sources: [], gaps: [] }
    },
  })
  await service.poll(new Date('2026-09-03T00:00:00.000Z'))
  await service.poll(new Date('2026-09-03T01:00:00.000Z'))
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.id, 'work-journal:daily:2026-09-02')
  assert.equal(checkpoint?.lastClosedDay, '2026-09-02')
})

test('repairs the checkpoint without recompiling when the daily signal already exists', async () => {
  let checkpoint: Readonly<Record<string, unknown>> | undefined
  let compileCount = 0
  const existing = {
    id: 'work-journal:daily:2026-09-02', kind: 'assistant.work-journal.daily.v1',
    occurredAt: '2026-09-02T23:59:59.999+08:00', recordedAt: '2026-09-03T05:00:00.000Z',
    scope: { day: '2026-09-02' }, data: { version: 1, day: '2026-09-02', headline: '已生成' },
  }
  const store = {
    async readFeatureCheckpoint() { return checkpoint },
    async writeFeatureCheckpoint(_namespace: string, _key: string, value: Readonly<Record<string, unknown>>) { checkpoint = value },
    async appendSignal() { throw new Error('must not append') },
    async recentSignals() { return [existing] },
  }
  const service = new WorkJournalService({
    enabled: true, timeZone: 'Asia/Shanghai', closeHour: 5, pollIntervalMs: 3_600_000,
    modelTimeoutMs: 60_000, workspace: '/tmp', claudeCli: 'claude', codexCli: 'codex',
  }, store, { async load(day) { return { day } } }, { async compile() { compileCount += 1; throw new Error('must not compile') } })
  await service.poll(new Date('2026-09-03T00:00:00.000Z'))
  assert.equal(compileCount, 0)
  assert.equal(checkpoint?.lastClosedDay, '2026-09-02')
})
