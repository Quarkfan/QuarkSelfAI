import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
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

interface SqliteEventRow {
  id: string
  event_key: string
  deduplication_key: string
  source: string
  occurred_at: string | null
  received_at: string
}

export class SqliteAssistantStore implements AssistantStore {
  readonly kind = 'sqlite' as const

  constructor(
    private readonly database: DatabaseSync,
    private readonly migrationDirectory: string,
  ) {}

  async migrate(): Promise<void> {
    this.database.exec(
      `CREATE TABLE IF NOT EXISTS schema_migration (
         version TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       )`,
    )
    const files = (await readdir(this.migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
    const hasMigration = this.database.prepare('SELECT 1 FROM schema_migration WHERE version = ?')
    const recordMigration = this.database.prepare('INSERT INTO schema_migration (version) VALUES (?)')
    for (const file of files) {
      if (hasMigration.get(file)) continue
      this.database.exec(await readFile(`${this.migrationDirectory}/${file}`, 'utf8'))
      recordMigration.run(file)
    }
  }

  async health(): Promise<void> {
    this.database.prepare('SELECT 1 AS ok').get()
  }

  async close(): Promise<void> {
    this.database.close()
  }

  async appendEvent(id: string, event: NormalizedChannelEvent): Promise<StoredEvent> {
    const result = this.database.prepare(
      `INSERT INTO assistant_event
        (id, event_key, deduplication_key, source, payload, raw, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (deduplication_key) DO NOTHING`,
    ).run(
      id,
      event.eventKey,
      event.deduplicationKey,
      JSON.stringify(event.source),
      JSON.stringify(event.payload),
      JSON.stringify(event.raw),
      event.occurredAt ?? null,
    )
    if (result.changes === 1) return { id, inserted: true }
    const existing = this.database.prepare(
      'SELECT id FROM assistant_event WHERE deduplication_key = ?',
    ).get(event.deduplicationKey) as { id: string } | undefined
    if (!existing) throw new Error(`event ${event.deduplicationKey} was not persisted or found`)
    return { id: existing.id, inserted: false }
  }

  async updateCheckpoint(consumerName: string, eventKey: string, cursor: Readonly<Record<string, unknown>>): Promise<void> {
    this.database.prepare(
      `INSERT INTO consumer_checkpoint (consumer_name, event_key, cursor)
       VALUES (?, ?, ?)
       ON CONFLICT (consumer_name, event_key) DO UPDATE
       SET cursor = excluded.cursor, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).run(consumerName, eventKey, JSON.stringify(cursor))
  }

  async overview(): Promise<OverviewCounts> {
    const row = this.database.prepare(
      `SELECT
        (SELECT count(*) FROM assistant_event) AS events,
        (SELECT count(*) FROM matter WHERE status IN ('open', 'waiting')) AS open_matters,
        (SELECT count(*) FROM action_record WHERE state IN ('observed', 'settling', 'planned', 'awaiting-approval', 'executing', 'waiting-external')) AS active_actions,
        (SELECT count(*) FROM approval_request WHERE status = 'pending') AS pending_approvals,
        (SELECT count(*) FROM action_record WHERE state = 'failed') AS failed_actions`,
    ).get() as Record<string, number>
    return {
      events: Number(row.events),
      openMatters: Number(row.open_matters),
      activeActions: Number(row.active_actions),
      pendingApprovals: Number(row.pending_approvals),
      failedActions: Number(row.failed_actions),
    }
  }

  async recentEvents(limit: number): Promise<readonly EventSummary[]> {
    const rows = this.database.prepare(
      `SELECT id, event_key, deduplication_key, source, occurred_at, received_at
       FROM assistant_event ORDER BY received_at DESC LIMIT ?`,
    ).all(limit) as unknown as SqliteEventRow[]
    return rows.map((row) => ({
      id: row.id,
      eventKey: row.event_key,
      deduplicationKey: row.deduplication_key,
      source: JSON.parse(row.source) as Record<string, unknown>,
      occurredAt: row.occurred_at,
      receivedAt: row.received_at,
    }))
  }

  async recentMatters(limit: number): Promise<readonly MatterSummary[]> {
    const rows = this.database.prepare(
      `SELECT id, status, title, latest_summary, updated_at
       FROM matter ORDER BY updated_at DESC LIMIT ?`,
    ).all(limit) as unknown as Array<Record<string, string>>
    return rows.map((row) => ({
      id: row.id ?? '',
      status: row.status ?? '',
      title: row.title ?? '',
      latestSummary: row.latest_summary ?? '',
      updatedAt: row.updated_at ?? '',
    }))
  }

  async recentActions(limit: number): Promise<readonly ActionSummary[]> {
    const rows = this.database.prepare(
      `SELECT id, matter_id, state, intent, executor, updated_at
       FROM action_record ORDER BY updated_at DESC LIMIT ?`,
    ).all(limit) as unknown as Array<Record<string, string | null>>
    return rows.map((row) => ({
      id: row.id ?? '',
      matterId: row.matter_id ?? '',
      state: row.state ?? '',
      intent: row.intent ?? '',
      executor: row.executor ?? null,
      updatedAt: row.updated_at ?? '',
    }))
  }

  async pendingApprovals(limit: number): Promise<readonly ApprovalSummary[]> {
    const rows = this.database.prepare(
      `SELECT id, action_id, status, prompt, requested_at
       FROM approval_request WHERE status = 'pending'
       ORDER BY requested_at ASC LIMIT ?`,
    ).all(limit) as unknown as Array<Record<string, string>>
    return rows.map((row) => ({
      id: row.id ?? '',
      actionId: row.action_id ?? '',
      status: row.status ?? '',
      prompt: row.prompt ?? '',
      requestedAt: row.requested_at ?? '',
    }))
  }

  async savePolicyDraft(input: PolicyDraftInput): Promise<number> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(
        `INSERT INTO policy_definition (id, name, status)
         VALUES (?, ?, 'draft')
         ON CONFLICT (id) DO UPDATE SET name = excluded.name,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ).run(input.id, input.name)
      const row = this.database.prepare(
        'SELECT coalesce(max(revision), 0) + 1 AS revision FROM policy_revision WHERE policy_id = ?',
      ).get(input.id) as { revision: number }
      this.database.prepare(
        `INSERT INTO policy_revision (policy_id, revision, source_text, compiled, simulation)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(input.id, row.revision, input.sourceText, JSON.stringify(input.document), JSON.stringify(input.simulation))
      this.database.exec('COMMIT')
      return row.revision
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async activatePolicy(id: string, revision: number, approvedAt: string): Promise<void> {
    const row = this.database.prepare(
      'SELECT simulation FROM policy_revision WHERE policy_id = ? AND revision = ?',
    ).get(id, revision) as { simulation: string } | undefined
    if (!row) throw new Error(`policy ${id} revision ${revision} does not exist`)
    const simulation = JSON.parse(row.simulation) as { safeToActivate?: boolean }
    if (simulation.safeToActivate !== true) throw new Error(`policy ${id} revision ${revision} failed the safety simulation`)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(
        'UPDATE policy_revision SET approved_at = ? WHERE policy_id = ? AND revision = ?',
      ).run(approvedAt, id, revision)
      const result = this.database.prepare(
        `UPDATE policy_definition SET status = 'enabled', active_revision = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(revision, id)
      if (result.changes !== 1) throw new Error(`policy ${id} does not exist`)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async policies(limit: number): Promise<readonly PolicySummary[]> {
    const rows = this.database.prepare(
      `SELECT p.id, p.name, p.status, p.updated_at,
              r.revision, r.source_text, r.compiled, r.simulation
       FROM policy_definition p
       JOIN policy_revision r ON r.policy_id = p.id
        AND r.revision = coalesce(p.active_revision, (
          SELECT max(latest.revision) FROM policy_revision latest WHERE latest.policy_id = p.id
        ))
       ORDER BY p.updated_at DESC LIMIT ?`,
    ).all(limit) as unknown as Array<Record<string, string | number>>
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      status: String(row.status) as PolicySummary['status'],
      revision: Number(row.revision),
      sourceText: String(row.source_text),
      document: JSON.parse(String(row.compiled)) as PolicySummary['document'],
      simulation: JSON.parse(String(row.simulation)) as PolicySummary['simulation'],
      updatedAt: String(row.updated_at),
    }))
  }
}

export async function createSqliteStore(databasePath: string, migrationDirectory: string): Promise<SqliteAssistantStore> {
  if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  return new SqliteAssistantStore(database, migrationDirectory)
}
