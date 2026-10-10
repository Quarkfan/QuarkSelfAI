import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeStoreWorkJournalCompiler } from '../src/work-journal/native-evidence.js'

test('compiles a portable journal without company sources, executors or external reads', async () => {
  const compiler = new NativeStoreWorkJournalCompiler()
  const result = await compiler.compile('2026-10-10', {
    events: [{ id: 'event-1' }], actions: [{ id: 'action-1' }],
    matters: [{ id: 'matter-1', title: 'Synthetic matter', latestSummary: 'Synthetic progress' }],
  }, AbortSignal.abort())
  assert.equal(result.day, '2026-10-10')
  assert.equal(result.highlights[0]?.title, 'Synthetic matter')
  assert.match(result.gaps[0] ?? '', /External work sources/)
  assert.equal(JSON.stringify(result).includes('BlackLake'), false)
})
