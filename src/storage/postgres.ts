import { readFile } from 'node:fs/promises'
import type { PoolConfig, QueryResult, QueryResultRow } from 'pg'
import pg from 'pg'
import type { NormalizedChannelEvent } from '../domain/contracts.js'

const { Pool } = pg

export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>
}

export interface StoredEvent {
  readonly id: string
  readonly inserted: boolean
}

export class PgAssistantStore {
  constructor(private readonly database: SqlExecutor) {}

  async appendEvent(id: string, event: NormalizedChannelEvent): Promise<StoredEvent> {
    const result = await this.database.query<{ id: string; inserted: boolean }>(
      `WITH inserted AS (
         INSERT INTO assistant_event
           (id, event_key, deduplication_key, source, payload, raw, occurred_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::timestamptz)
         ON CONFLICT (deduplication_key) DO NOTHING
         RETURNING id
       )
       SELECT id, true AS inserted FROM inserted
       UNION ALL
       SELECT id, false AS inserted
       FROM assistant_event
       WHERE deduplication_key = $3 AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [
        id,
        event.eventKey,
        event.deduplicationKey,
        JSON.stringify(event.source),
        JSON.stringify(event.payload),
        JSON.stringify(event.raw),
        event.occurredAt ?? null,
      ],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`event ${event.deduplicationKey} was not persisted or found`)
    return { id: row.id, inserted: row.inserted }
  }

  async updateCheckpoint(consumerName: string, eventKey: string, cursor: Readonly<Record<string, unknown>>): Promise<void> {
    await this.database.query(
      `INSERT INTO consumer_checkpoint (consumer_name, event_key, cursor)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (consumer_name, event_key) DO UPDATE
       SET cursor = EXCLUDED.cursor, updated_at = now()`,
      [consumerName, eventKey, JSON.stringify(cursor)],
    )
  }
}

export function createPgPool(config: PoolConfig = {}): InstanceType<typeof Pool> {
  return new Pool({ connectionString: process.env.DATABASE_URL, ...config })
}

export async function migrate(database: SqlExecutor, migrationFile: string): Promise<void> {
  const sql = await readFile(migrationFile, 'utf8')
  await database.query(sql)
}
