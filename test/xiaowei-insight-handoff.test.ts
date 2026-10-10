import assert from 'node:assert/strict'
import test from 'node:test'
import { applyXiaoweiInsightHandoff, prepareXiaoweiInsightHandoff } from '../src/migration/xiaowei-insight-handoff.js'

test('migrates only the Xiaowei insight delivery boundary and replays idempotently', async () => {
  const handoff = prepareXiaoweiInsightHandoff({ xiaoweiInsightDigest: {
    lastSentDay: '2026-10-09', lastWindowEndAt: '2026-10-09T09:30:00.000Z', lastAttemptAt: '2026-10-09T09:30:00.000Z',
    failure: { error: 'must not migrate' }, reports: [{ body: 'must not migrate' }],
  } })
  assert.deepEqual(handoff.counts, { completedWindows: 1, reports: 1 })
  assert.equal(JSON.stringify(handoff).includes('must not migrate'), false)
  assert.match(String(handoff.checkpoint?.deliveryFingerprint), /^[a-f0-9]{64}$/u)
  const checkpoints = new Map<string, Readonly<Record<string, unknown>>>()
  const target = {
    async readFeatureCheckpoint(namespace: string, key: string) { return checkpoints.get(`${namespace}:${key}`) },
    async writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>) { checkpoints.set(`${namespace}:${key}`, value) },
  }
  assert.deepEqual(await applyXiaoweiInsightHandoff(target, handoff, handoff.digest), { written: 1, existing: 0 })
  assert.deepEqual(await applyXiaoweiInsightHandoff(target, handoff, handoff.digest), { written: 0, existing: 1 })
  await assert.rejects(applyXiaoweiInsightHandoff(target, handoff, 'wrong'), /digest changed/)
  checkpoints.set('xiaowei-insight-digest:delivery-window', { different: true })
  await assert.rejects(applyXiaoweiInsightHandoff(target, handoff, handoff.digest), /different content/)
})

test('rejects incomplete delivery boundaries and treats absent state as empty', () => {
  assert.equal(prepareXiaoweiInsightHandoff({}).counts.completedWindows, 0)
  assert.throws(() => prepareXiaoweiInsightHandoff({ xiaoweiInsightDigest: { lastSentDay: '2026-10-09' } }), /no window end/)
  assert.throws(() => prepareXiaoweiInsightHandoff({ xiaoweiInsightDigest: { lastWindowEndAt: '2026-10-09T09:30:00.000Z' } }), /no completed day/)
})
