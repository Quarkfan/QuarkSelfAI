import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { eventToPolicySample } from '../policy/samples.js'
import type {
  ActionClaimRelease,
  ActionSummary,
  ApprovalSummary,
  AssistantStore,
  ClaimedAction,
  DurableActionInput,
  DurableSignal,
  DurableSignalInput,
  EventSummary,
  MatterSummary,
  OverviewCounts,
  PolicyDraftInput,
  PolicySummary,
  StoredEvent,
} from './types.js'
import type { ExecutorRequest, ExecutorResult } from '../domain/contracts.js'

interface SqliteEventRow {
  id: string
  event_key: string
  deduplication_key: string
  source: string
  occurred_at: string | null
  received_at: string
}

interface SqlitePolicyEventRow {
  id: string
  source: string
  payload: string
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
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

  async appendSignal(input: DurableSignalInput): Promise<{ readonly inserted: boolean }> {
    const scope = canonicalJson(input.scope ?? {})
    const data = canonicalJson(input.data)
    const result = this.database.prepare(
      `INSERT INTO assistant_signal (id, kind, occurred_at, scope, data)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    ).run(input.id, input.kind, input.occurredAt, scope, data)
    if (result.changes === 1) return { inserted: true }
    const existing = this.database.prepare(
      'SELECT kind, occurred_at, scope, data FROM assistant_signal WHERE id = ?',
    ).get(input.id) as { kind: string; occurred_at: string; scope: string; data: string } | undefined
    if (!existing || existing.kind !== input.kind || existing.occurred_at !== input.occurredAt
      || existing.scope !== scope || existing.data !== data) {
      throw new Error(`signal ${input.id} already exists with different durable content`)
    }
    return { inserted: false }
  }

  async recentSignals(kind: string, limit: number): Promise<readonly DurableSignal[]> {
    const rows = this.database.prepare(
      `SELECT id, kind, occurred_at, scope, data, recorded_at
       FROM assistant_signal WHERE kind = ? ORDER BY occurred_at DESC LIMIT ?`,
    ).all(kind, limit) as unknown as Array<Record<string, string>>
    return rows.map(row => ({
      id: row.id ?? '',
      kind: row.kind ?? '',
      occurredAt: row.occurred_at ?? '',
      scope: JSON.parse(row.scope ?? '{}') as Record<string, unknown>,
      data: JSON.parse(row.data ?? '{}') as Record<string, unknown>,
      recordedAt: row.recorded_at ?? '',
    }))
  }

  async readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    const row = this.database.prepare(
      'SELECT value FROM feature_checkpoint WHERE namespace = ? AND key = ?',
    ).get(namespace, key) as { value: string } | undefined
    return row ? JSON.parse(row.value) as Record<string, unknown> : undefined
  }

  async writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    this.database.prepare(
      `INSERT INTO feature_checkpoint (namespace, key, value) VALUES (?, ?, ?)
       ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).run(namespace, key, canonicalJson(value))
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

  async recentPolicySamples(limit: number) {
    const rows = this.database.prepare(
      `SELECT id, source, payload FROM assistant_event
       WHERE event_key = 'im.message.receive_v1'
       ORDER BY received_at DESC LIMIT ?`,
    ).all(limit) as unknown as SqlitePolicyEventRow[]
    return rows.map((row) => eventToPolicySample({
      id: row.id,
      source: JSON.parse(row.source) as Record<string, unknown>,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
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
      const compiled = JSON.stringify(input.document)
      const simulation = JSON.stringify(input.simulation)
      const existing = this.database.prepare(
        `SELECT revision FROM policy_revision
         WHERE policy_id = ? AND source_text = ? AND compiled = ? AND simulation = ?
         ORDER BY revision DESC LIMIT 1`,
      ).get(input.id, input.sourceText, compiled, simulation) as { revision: number } | undefined
      if (existing) {
        this.database.exec('COMMIT')
        return existing.revision
      }
      const row = this.database.prepare(
        'SELECT coalesce(max(revision), 0) + 1 AS revision FROM policy_revision WHERE policy_id = ?',
      ).get(input.id) as { revision: number }
      this.database.prepare(
        `INSERT INTO policy_revision (policy_id, revision, source_text, compiled, simulation)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(input.id, row.revision, input.sourceText, compiled, simulation)
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

  async enqueueAction(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    if (input.request.mode !== 'read-only' && !input.approval) {
      throw new Error(`${input.request.mode} action requires an approval request`)
    }
    const request = canonicalJson({ actionId: input.actionId, ...input.request })
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(
        `INSERT INTO matter (id, status, title, latest_summary)
         VALUES (?, 'open', ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      ).run(input.matterId, input.matterTitle, input.matterSummary)
      const action = this.database.prepare(
        `INSERT INTO action_record
          (id, matter_id, state, intent, source, approval_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      ).run(
        input.actionId,
        input.matterId,
        input.approval ? 'awaiting-approval' : 'planned',
        input.intent,
        JSON.stringify(input.source),
        input.approval?.id ?? null,
      )
      if (action.changes === 0) {
        const existing = this.database.prepare(
          `SELECT e.request, a.matter_id, a.intent
           FROM action_execution e JOIN action_record a ON a.id = e.action_id
           WHERE e.action_id = ?`,
        ).get(input.actionId) as { request: string; matter_id: string; intent: string } | undefined
        if (!existing || existing.request !== request || existing.matter_id !== input.matterId || existing.intent !== input.intent) {
          throw new Error(`action ${input.actionId} already exists with different durable content`)
        }
        this.database.exec('COMMIT')
        return { inserted: false }
      }
      if (input.approval) {
        this.database.prepare(
          `INSERT INTO approval_request (id, action_id, status, prompt)
           VALUES (?, ?, 'pending', ?)`,
        ).run(input.approval.id, input.actionId, input.approval.prompt)
      }
      this.database.prepare(
        `INSERT INTO action_execution (action_id, request, requested_executor, status)
         VALUES (?, ?, ?, 'pending')`,
      ).run(input.actionId, request, input.requestedExecutor ?? null)
      this.database.prepare(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, idempotency_key)
         VALUES (?, NULL, ?, 'durable action enqueued', ?)`,
      ).run(input.actionId, input.approval ? 'awaiting-approval' : 'planned', `${input.actionId}:enqueue`)
      this.database.exec('COMMIT')
      return { inserted: true }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt: string): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const approval = this.database.prepare(
        'SELECT action_id, status FROM approval_request WHERE id = ?',
      ).get(approvalId) as { action_id: string; status: string } | undefined
      if (!approval) throw new Error(`approval ${approvalId} does not exist`)
      if (approval.status !== 'pending') {
        if (approval.status === decision) {
          this.database.exec('COMMIT')
          return
        }
        throw new Error(`approval ${approvalId} is already ${approval.status}`)
      }
      this.database.prepare(
        `UPDATE approval_request SET status = ?, decision = ?, decided_at = ? WHERE id = ?`,
      ).run(decision, JSON.stringify(metadata), decidedAt, approvalId)
      const actionState = decision === 'approved' ? 'planned' : 'failed'
      this.database.prepare(
        `UPDATE action_record SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(actionState, approval.action_id)
      if (decision === 'rejected') {
        this.database.prepare(
          `UPDATE action_execution SET status = 'failed', last_error = 'owner rejected approval',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE action_id = ?`,
        ).run(approval.action_id)
      }
      this.database.prepare(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES (?, 'awaiting-approval', ?, ?, ?, ?)`,
      ).run(
        approval.action_id,
        actionState,
        `owner ${decision} action`,
        JSON.stringify(metadata),
        `${approval.action_id}:approval:${approvalId}:${decision}`,
      )
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async claimNextAction(workerId: string, workspace: string, now: string, leaseExpiresAt: string): Promise<ClaimedAction | undefined> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const row = this.database.prepare(
        `SELECT e.action_id, e.request, e.requested_executor, e.attempt,
                CASE WHEN a.approval_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM approval_request granted
                  WHERE granted.id = a.approval_id AND granted.action_id = a.id AND granted.status = 'approved'
                ) THEN 1 ELSE 0 END AS approval_granted,
                a.state
         FROM action_execution e
         JOIN action_record a ON a.id = e.action_id
         WHERE json_extract(e.request, '$.workspace') = ?
           AND e.available_at <= ?
           AND (e.status = 'pending' OR (e.status = 'executing' AND e.lease_expires_at <= ?))
           AND (a.approval_id IS NULL OR EXISTS (
             SELECT 1 FROM approval_request p
             WHERE p.id = a.approval_id AND p.action_id = a.id AND p.status = 'approved'
           ))
         ORDER BY e.available_at, e.created_at
         LIMIT 1`,
      ).get(workspace, now, now) as {
        action_id: string
        request: string
        requested_executor: ExecutorResult['executor'] | null
        attempt: number
        approval_granted: number
        state: string
      } | undefined
      if (!row) {
        this.database.exec('COMMIT')
        return undefined
      }
      const attempt = row.attempt + 1
      const claimed = this.database.prepare(
        `UPDATE action_execution
         SET status = 'executing', lease_owner = ?, lease_expires_at = ?, attempt = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE action_id = ? AND (status = 'pending' OR (status = 'executing' AND lease_expires_at <= ?))`,
      ).run(workerId, leaseExpiresAt, attempt, row.action_id, now)
      if (claimed.changes !== 1) throw new Error(`action ${row.action_id} lost its claim race`)
      this.database.prepare(
        `UPDATE action_record SET state = 'executing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(row.action_id)
      this.database.prepare(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES (?, ?, 'executing', 'worker claimed durable action', ?, ?)`,
      ).run(row.action_id, row.state, JSON.stringify({ workerId, attempt, leaseExpiresAt }), `${row.action_id}:claim:${attempt}`)
      this.database.exec('COMMIT')
      return {
        actionId: row.action_id,
        request: JSON.parse(row.request) as ExecutorRequest,
        ...(row.requested_executor ? { requestedExecutor: row.requested_executor } : {}),
        approvalGranted: row.approval_granted === 1,
        attempt,
      }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async settleAction(actionId: string, workerId: string, result: ExecutorResult): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const execution = this.database.prepare(
        `SELECT attempt FROM action_execution WHERE action_id = ? AND status = 'executing' AND lease_owner = ?`,
      ).get(actionId, workerId) as { attempt: number } | undefined
      if (!execution) throw new Error(`worker ${workerId} does not own action ${actionId}`)
      const actionState = result.status === 'completed' ? 'completed' : result.status === 'needs-input' ? 'waiting-external' : 'failed'
      this.database.prepare(
        `UPDATE action_execution SET status = ?, result = ?, last_error = ?, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE action_id = ?`,
      ).run(result.status, JSON.stringify(result), result.status === 'failed' ? result.summary : null, actionId)
      this.database.prepare(
        `UPDATE action_record SET state = ?, executor = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(actionState, result.executor, actionId)
      this.database.prepare(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES (?, 'executing', ?, 'executor settled durable action', ?, ?)`,
      ).run(actionId, actionState, JSON.stringify({ workerId, result }), `${actionId}:settle:${execution.attempt}`)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async releaseActionClaim(input: ActionClaimRelease): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const execution = this.database.prepare(
        `SELECT attempt FROM action_execution WHERE action_id = ? AND status = 'executing' AND lease_owner = ?`,
      ).get(input.actionId, input.workerId) as { attempt: number } | undefined
      if (!execution) throw new Error(`worker ${input.workerId} does not own action ${input.actionId}`)
      const status = input.disposition === 'retry' ? 'pending' : 'failed'
      const actionState = input.disposition === 'retry' ? 'planned' : 'failed'
      this.database.prepare(
        `UPDATE action_execution SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
           available_at = ?, last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE action_id = ?`,
      ).run(status, input.availableAt ?? new Date().toISOString(), input.error, input.actionId)
      this.database.prepare(
        `UPDATE action_record SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(actionState, input.actionId)
      this.database.prepare(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES (?, 'executing', ?, ?, ?, ?)`,
      ).run(
        input.actionId,
        actionState,
        input.error,
        JSON.stringify({ workerId: input.workerId, disposition: input.disposition, availableAt: input.availableAt }),
        `${input.actionId}:release:${execution.attempt}:${input.disposition}`,
      )
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

export async function createSqliteStore(databasePath: string, migrationDirectory: string): Promise<SqliteAssistantStore> {
  if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  return new SqliteAssistantStore(database, migrationDirectory)
}
