import assert from 'node:assert/strict'
import test from 'node:test'
import type { QueryResult, QueryResultRow } from 'pg'
import { PgAssistantStore, type SqlExecutor } from '../src/storage/postgres.js'

test('persists the normalized event with its stable deduplication key', async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = []
  const database: SqlExecutor = {
    async query<R extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      calls.push({ text, ...(values ? { values } : {}) })
      return { rows: [{ id: 'evt-row', inserted: true }] as R[], rowCount: 1 } as QueryResult<R>
    },
  }
  const store = new PgAssistantStore(database)
  const result = await store.appendEvent('evt-row', {
    kind: 'message.received',
    source: { channel: 'feishu', messageId: 'om-1' },
    eventKey: 'im.message.receive_v1',
    deduplicationKey: 'om-1',
    payload: { content: 'hello' },
    raw: { message_id: 'om-1', future_field: true },
  })
  assert.deepEqual(result, { id: 'evt-row', inserted: true })
  assert.equal(calls[0]?.values?.[2], 'om-1')
  assert.match(String(calls[0]?.values?.[5]), /future_field/)
})

test('reports a duplicate event without creating another record', async () => {
  const database: SqlExecutor = {
    async query<R extends QueryResultRow>() {
      return { rows: [{ id: 'existing-id', inserted: false }] as R[], rowCount: 1 } as QueryResult<R>
    },
  }
  const result = await new PgAssistantStore(database).appendEvent('new-id', {
    kind: 'lark.event',
    source: { channel: 'feishu' },
    eventKey: 'future.event',
    deduplicationKey: 'same-event',
    payload: {},
    raw: {},
  })
  assert.deepEqual(result, { id: 'existing-id', inserted: false })
})
