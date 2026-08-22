import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSqliteStore } from '../src/storage/sqlite.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))

test('SQLite is a zero-configuration durable default with event idempotency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-sqlite-'))
  const database = join(directory, 'assistant.sqlite3')
  const store = await createSqliteStore(database, migrations)
  try {
    await store.migrate()
    await store.migrate()
    const event = {
      kind: 'message.received' as const,
      source: { channel: 'feishu' as const, messageId: 'om-sqlite' },
      eventKey: 'im.message.receive_v1',
      deduplicationKey: 'om-sqlite',
      payload: { content: 'hello' },
      raw: { message_id: 'om-sqlite' },
    }
    assert.deepEqual(await store.appendEvent('row-1', event), { id: 'row-1', inserted: true })
    assert.deepEqual(await store.appendEvent('row-2', event), { id: 'row-1', inserted: false })
    assert.equal((await store.overview()).events, 1)
    assert.equal((await store.recentEvents(10))[0]?.deduplicationKey, 'om-sqlite')
    const revision = await store.savePolicyDraft({
      id: 'policy-1',
      name: '普通消息进入汇总',
      sourceText: '没有明确提到我的群消息放到汇总里',
      document: {
        version: 1,
        name: '普通消息进入汇总',
        description: '降低普通群消息干扰',
        priority: 100,
        when: { fact: 'message.mentionsOwner', op: 'eq', value: false },
        effect: { attention: 'batch' },
      },
      simulation: {
        sampleCount: 10,
        matchedCount: 6,
        silentCount: 0,
        batchCount: 6,
        realtimeCount: 0,
        urgentSuppressedCount: 0,
        safeToActivate: true,
        matchedSampleIds: ['sample-1'],
      },
    })
    assert.equal(revision, 1)
    await store.activatePolicy('policy-1', revision, '2026-08-22T10:00:00.000Z')
    const storedPolicy = (await store.policies(10))[0]
    assert.equal(storedPolicy?.status, 'enabled')
    assert.equal(storedPolicy?.sourceText, '没有明确提到我的群消息放到汇总里')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
