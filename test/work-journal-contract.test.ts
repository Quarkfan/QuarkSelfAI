import assert from 'node:assert/strict'
import test from 'node:test'
import { dailyWorkJournalRecord, queryWorkJournal, workJournalSignal } from '../src/work-journal/contract.js'

test('creates an immutable daily work signal and queries an inclusive range', () => {
  const record = dailyWorkJournalRecord({
    version: 1, day: '2026-09-02', headline: '推进关键工作', highlights: [], decisions: [],
    deliverables: [], collaboration: [], nextSteps: [], sources: [], gaps: [],
  })
  const signal = { ...workJournalSignal(record), recordedAt: '2026-09-03T05:00:00.000Z' }
  assert.equal(signal.id, 'work-journal:daily:2026-09-02')
  assert.deepEqual(queryWorkJournal([signal], '2026-09-01', '2026-09-02'), [record])
  assert.deepEqual(queryWorkJournal([signal], '2026-09-03', '2026-09-04'), [])
})

test('rejects malformed and oversized daily records', () => {
  assert.throws(() => dailyWorkJournalRecord({ version: 1, day: 'not-a-day' }), /calendar date/)
  assert.throws(() => dailyWorkJournalRecord({
    version: 1, day: '2026-09-02', headline: '超大记录', highlights: [],
    decisions: Array(20).fill('中'.repeat(500)), deliverables: Array(20).fill('中'.repeat(500)),
    collaboration: Array(20).fill('中'.repeat(500)), nextSteps: Array(20).fill('中'.repeat(500)),
    sources: [], gaps: Array(20).fill('中'.repeat(500)),
  }), /128 KiB/)
})

test('retains only bounded journal fields from model output', () => {
  const record = dailyWorkJournalRecord({
    version: 1, day: '2026-09-02', headline: '  关键   进展  ', secret: 'drop-me',
    highlights: [{ title: '事项', summary: '结论', status: 'unknown', confidence: 'unknown', rawMessage: 'drop-me' }],
    decisions: [], deliverables: [], collaboration: [], nextSteps: [],
    sources: [{ kind: 'jira', status: 'available', evidenceCount: 2, credential: 'drop-me' }], gaps: [],
  })
  assert.equal(record.headline, '关键 进展')
  assert.equal(record.secret, undefined)
  assert.deepEqual(record.highlights[0], { title: '事项', summary: '结论', status: 'observed', outcomes: [], sourceRefs: [], confidence: 'low' })
  assert.deepEqual(record.sources[0], { kind: 'jira', status: 'available', evidenceCount: 2, note: '' })
})
