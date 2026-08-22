import { readFile, readdir } from 'node:fs/promises'
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg'
import pg from 'pg'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { eventToPolicySample, type PolicyEventSampleInput } from '../policy/samples.js'
import type {
  ActionSummary,
  ApprovalSummary,
  AssistantStore,
  EventSummary,
  MatterSummary,
  OverviewCounts,
  PolicyDraftInput,
  PolicySummary,
  StoredEvent,
} from './types.js'

const { Pool } = pg

export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>
}

interface ClosableSqlExecutor extends SqlExecutor {
  end?(): Promise<void>
  connect?(): Promise<PoolClient>
}

export class PgAssistantStore implements AssistantStore {
  readonly kind = 'postgres' as const

  constructor(
    private readonly database: ClosableSqlExecutor,
    private readonly migrationDirectory?: string,
  ) {}

  private async transaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.database.connect?.()
    if (!client) return await operation(this.database)
    try {
      await client.query('BEGIN')
      const value = await operation(client)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async migrate(): Promise<void> {
    if (!this.migrationDirectory) return
    const client = await this.database.connect?.()
    const executor: SqlExecutor = client ?? this.database
    try {
      if (client) await executor.query("SELECT pg_advisory_lock(hashtext('quark-self-ai:migrations'))")
      await executor.query(
        `CREATE TABLE IF NOT EXISTS schema_migration (
           version text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      )
      const applied = await executor.query<{ version: string }>('SELECT version FROM schema_migration')
      const versions = new Set(applied.rows.map((row) => row.version))
      const files = (await readdir(this.migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
      for (const file of files) {
        if (versions.has(file)) continue
        await executor.query(await readFile(`${this.migrationDirectory}/${file}`, 'utf8'))
        await executor.query('INSERT INTO schema_migration (version) VALUES ($1)', [file])
      }
    } finally {
      if (client) {
        try {
          await executor.query('ROLLBACK').catch(() => undefined)
          await executor.query("SELECT pg_advisory_unlock(hashtext('quark-self-ai:migrations'))")
        } finally {
          client.release()
        }
      }
    }
  }

  async health(): Promise<void> {
    await this.database.query('SELECT 1 AS ok')
  }

  async close(): Promise<void> {
    await this.database.end?.()
  }

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

  async overview(): Promise<OverviewCounts> {
    const result = await this.database.query<{
      events: string
      openMatters: string
      activeActions: string
      pendingApprovals: string
      failedActions: string
    }>(
      `SELECT
        (SELECT count(*) FROM assistant_event) AS events,
        (SELECT count(*) FROM matter WHERE status IN ('open', 'waiting')) AS "openMatters",
        (SELECT count(*) FROM action_record WHERE state IN ('observed', 'settling', 'planned', 'awaiting-approval', 'executing', 'waiting-external')) AS "activeActions",
        (SELECT count(*) FROM approval_request WHERE status = 'pending') AS "pendingApprovals",
        (SELECT count(*) FROM action_record WHERE state = 'failed') AS "failedActions"`,
    )
    const row = result.rows[0]
    if (!row) throw new Error('postgres overview query returned no row')
    return {
      events: Number(row.events),
      openMatters: Number(row.openMatters),
      activeActions: Number(row.activeActions),
      pendingApprovals: Number(row.pendingApprovals),
      failedActions: Number(row.failedActions),
    }
  }

  async recentEvents(limit: number): Promise<readonly EventSummary[]> {
    const result = await this.database.query<EventSummary>(
      `SELECT id, event_key AS "eventKey", deduplication_key AS "deduplicationKey",
              source, occurred_at AS "occurredAt", received_at AS "receivedAt"
       FROM assistant_event ORDER BY received_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows
  }

  async recentPolicySamples(limit: number) {
    const result = await this.database.query<PolicyEventSampleInput>(
      `SELECT id, source, payload FROM assistant_event
       WHERE event_key = 'im.message.receive_v1'
       ORDER BY received_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows.map(eventToPolicySample)
  }

  async recentMatters(limit: number): Promise<readonly MatterSummary[]> {
    const result = await this.database.query<MatterSummary>(
      `SELECT id, status, title, latest_summary AS "latestSummary", updated_at AS "updatedAt"
       FROM matter ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows
  }

  async recentActions(limit: number): Promise<readonly ActionSummary[]> {
    const result = await this.database.query<ActionSummary>(
      `SELECT id, matter_id AS "matterId", state, intent, executor, updated_at AS "updatedAt"
       FROM action_record ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows
  }

  async pendingApprovals(limit: number): Promise<readonly ApprovalSummary[]> {
    const result = await this.database.query<ApprovalSummary>(
      `SELECT id, action_id AS "actionId", status, prompt, requested_at AS "requestedAt"
       FROM approval_request WHERE status = 'pending'
       ORDER BY requested_at ASC LIMIT $1`,
      [limit],
    )
    return result.rows
  }

  async savePolicyDraft(input: PolicyDraftInput): Promise<number> {
    return await this.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`quark-self-ai:policy:${input.id}`])
      await executor.query(
        `INSERT INTO policy_definition (id, name, status)
         VALUES ($1, $2, 'draft')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [input.id, input.name],
      )
      const compiled = JSON.stringify(input.document)
      const simulation = JSON.stringify(input.simulation)
      const existing = await executor.query<{ revision: number }>(
        `SELECT revision FROM policy_revision
         WHERE policy_id = $1 AND source_text = $2 AND compiled = $3::jsonb AND simulation = $4::jsonb
         ORDER BY revision DESC LIMIT 1`,
        [input.id, input.sourceText, compiled, simulation],
      )
      if (existing.rows[0]?.revision !== undefined) return existing.rows[0].revision
      const result = await executor.query<{ revision: number }>(
        `INSERT INTO policy_revision (policy_id, revision, source_text, compiled, simulation)
         SELECT $1, coalesce(max(revision), 0) + 1, $2, $3::jsonb, $4::jsonb
         FROM policy_revision WHERE policy_id = $1
         RETURNING revision`,
        [input.id, input.sourceText, compiled, simulation],
      )
      const revision = result.rows[0]?.revision
      if (revision === undefined) throw new Error(`policy ${input.id} revision was not persisted`)
      return revision
    })
  }

  async activatePolicy(id: string, revision: number, approvedAt: string): Promise<void> {
    await this.transaction(async (executor) => {
      const revisionResult = await executor.query<{ safe: boolean }>(
        `SELECT coalesce((simulation ->> 'safeToActivate')::boolean, false) AS safe
         FROM policy_revision WHERE policy_id = $1 AND revision = $2 FOR UPDATE`,
        [id, revision],
      )
      if (revisionResult.rows[0]?.safe !== true) throw new Error(`policy ${id} revision ${revision} failed the safety simulation or does not exist`)
      await executor.query(
        'UPDATE policy_revision SET approved_at = $3::timestamptz WHERE policy_id = $1 AND revision = $2',
        [id, revision, approvedAt],
      )
      const result = await executor.query(
        `UPDATE policy_definition SET status = 'enabled', active_revision = $2, updated_at = now()
         WHERE id = $1`,
        [id, revision],
      )
      if (result.rowCount !== 1) throw new Error(`policy ${id} does not exist`)
    })
  }

  async policies(limit: number): Promise<readonly PolicySummary[]> {
    const result = await this.database.query<PolicySummary>(
      `SELECT p.id, p.name, p.status,
              r.revision, r.source_text AS "sourceText", r.compiled AS document,
              r.simulation, p.updated_at AS "updatedAt"
       FROM policy_definition p
       JOIN LATERAL (
         SELECT * FROM policy_revision candidate
         WHERE candidate.policy_id = p.id
         ORDER BY (candidate.revision = p.active_revision) DESC, candidate.revision DESC
         LIMIT 1
       ) r ON true
       ORDER BY p.updated_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows
  }
}

export function createPgPool(config: PoolConfig = {}): InstanceType<typeof Pool> {
  return new Pool({ connectionString: process.env.DATABASE_URL, ...config })
}

export async function migratePostgres(database: SqlExecutor, migrationFile: string): Promise<void> {
  const sql = await readFile(migrationFile, 'utf8')
  await database.query(sql)
}
