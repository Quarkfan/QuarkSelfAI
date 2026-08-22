import { readFile, readdir } from 'node:fs/promises'
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg'
import pg from 'pg'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { eventToPolicySample, type PolicyEventSampleInput } from '../policy/samples.js'
import type {
  ActionClaimRelease,
  ActionSummary,
  ApprovalSummary,
  AssistantStore,
  ClaimedAction,
  DurableActionInput,
  EventSummary,
  MatterSummary,
  OverviewCounts,
  PolicyDraftInput,
  PolicySummary,
  StoredEvent,
} from './types.js'
import type { ExecutorRequest, ExecutorResult } from '../domain/contracts.js'

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

  async enqueueAction(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    if (input.request.mode !== 'read-only' && !input.approval) {
      throw new Error(`${input.request.mode} action requires an approval request`)
    }
    const request = { actionId: input.actionId, ...input.request }
    return await this.transaction(async (executor) => {
      await executor.query(
        `INSERT INTO matter (id, status, title, latest_summary)
         VALUES ($1, 'open', $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [input.matterId, input.matterTitle, input.matterSummary],
      )
      const action = await executor.query<{ id: string }>(
        `INSERT INTO action_record (id, matter_id, state, intent, source, approval_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          input.actionId,
          input.matterId,
          input.approval ? 'awaiting-approval' : 'planned',
          input.intent,
          JSON.stringify(input.source),
          input.approval?.id ?? null,
        ],
      )
      if (!action.rows[0]) {
        const existing = await executor.query<{ requestMatches: boolean; matterId: string; intent: string }>(
          `SELECT e.request = $2::jsonb AS "requestMatches", a.matter_id AS "matterId", a.intent
           FROM action_execution e JOIN action_record a ON a.id = e.action_id
           WHERE e.action_id = $1`,
          [input.actionId, JSON.stringify(request)],
        )
        const row = existing.rows[0]
        if (!row?.requestMatches || row.matterId !== input.matterId || row.intent !== input.intent) {
          throw new Error(`action ${input.actionId} already exists with different durable content`)
        }
        return { inserted: false }
      }
      if (input.approval) {
        await executor.query(
          `INSERT INTO approval_request (id, action_id, status, prompt)
           VALUES ($1, $2, 'pending', $3)`,
          [input.approval.id, input.actionId, input.approval.prompt],
        )
      }
      await executor.query(
        `INSERT INTO action_execution (action_id, request, requested_executor, status)
         VALUES ($1, $2::jsonb, $3, 'pending')`,
        [input.actionId, JSON.stringify(request), input.requestedExecutor ?? null],
      )
      await executor.query(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, idempotency_key)
         VALUES ($1, NULL, $2, 'durable action enqueued', $3)`,
        [input.actionId, input.approval ? 'awaiting-approval' : 'planned', `${input.actionId}:enqueue`],
      )
      return { inserted: true }
    })
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt: string): Promise<void> {
    await this.transaction(async (executor) => {
      const result = await executor.query<{ actionId: string; status: string }>(
        `SELECT action_id AS "actionId", status FROM approval_request WHERE id = $1 FOR UPDATE`,
        [approvalId],
      )
      const approval = result.rows[0]
      if (!approval) throw new Error(`approval ${approvalId} does not exist`)
      if (approval.status !== 'pending') {
        if (approval.status === decision) return
        throw new Error(`approval ${approvalId} is already ${approval.status}`)
      }
      await executor.query(
        `UPDATE approval_request SET status = $2, decision = $3::jsonb, decided_at = $4::timestamptz WHERE id = $1`,
        [approvalId, decision, JSON.stringify(metadata), decidedAt],
      )
      const actionState = decision === 'approved' ? 'planned' : 'failed'
      await executor.query('UPDATE action_record SET state = $2, updated_at = now() WHERE id = $1', [approval.actionId, actionState])
      if (decision === 'rejected') {
        await executor.query(
          `UPDATE action_execution SET status = 'failed', last_error = 'owner rejected approval', updated_at = now()
           WHERE action_id = $1`,
          [approval.actionId],
        )
      }
      await executor.query(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES ($1, 'awaiting-approval', $2, $3, $4::jsonb, $5)`,
        [
          approval.actionId,
          actionState,
          `owner ${decision} action`,
          JSON.stringify(metadata),
          `${approval.actionId}:approval:${approvalId}:${decision}`,
        ],
      )
    })
  }

  async claimNextAction(workerId: string, workspace: string, now: string, leaseExpiresAt: string): Promise<ClaimedAction | undefined> {
    return await this.transaction(async (executor) => {
      const result = await executor.query<{
        actionId: string
        request: ExecutorRequest
        requestedExecutor: ExecutorResult['executor'] | null
        attempt: number
        approvalGranted: boolean
        state: string
      }>(
        `SELECT e.action_id AS "actionId", e.request, e.requested_executor AS "requestedExecutor", e.attempt,
                (e.request ->> 'mode') <> 'read-only' AS "approvalGranted", a.state
         FROM action_execution e
         JOIN action_record a ON a.id = e.action_id
         WHERE e.request ->> 'workspace' = $1
           AND e.available_at <= $2::timestamptz
           AND (e.status = 'pending' OR (e.status = 'executing' AND e.lease_expires_at <= $2::timestamptz))
           AND (e.request ->> 'mode' = 'read-only' OR EXISTS (
             SELECT 1 FROM approval_request p
             WHERE p.id = a.approval_id AND p.action_id = a.id AND p.status = 'approved'
           ))
         ORDER BY e.available_at, e.created_at
         FOR UPDATE OF e SKIP LOCKED
         LIMIT 1`,
        [workspace, now],
      )
      const row = result.rows[0]
      if (!row) return undefined
      const attempt = row.attempt + 1
      await executor.query(
        `UPDATE action_execution SET status = 'executing', lease_owner = $2,
           lease_expires_at = $3::timestamptz, attempt = $4, updated_at = now()
         WHERE action_id = $1`,
        [row.actionId, workerId, leaseExpiresAt, attempt],
      )
      await executor.query(`UPDATE action_record SET state = 'executing', updated_at = now() WHERE id = $1`, [row.actionId])
      await executor.query(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES ($1, $2, 'executing', 'worker claimed durable action', $3::jsonb, $4)`,
        [row.actionId, row.state, JSON.stringify({ workerId, attempt, leaseExpiresAt }), `${row.actionId}:claim:${attempt}`],
      )
      return {
        actionId: row.actionId,
        request: row.request,
        ...(row.requestedExecutor ? { requestedExecutor: row.requestedExecutor } : {}),
        approvalGranted: row.approvalGranted,
        attempt,
      }
    })
  }

  async settleAction(actionId: string, workerId: string, result: ExecutorResult): Promise<void> {
    await this.transaction(async (executor) => {
      const execution = await executor.query<{ attempt: number }>(
        `SELECT attempt FROM action_execution
         WHERE action_id = $1 AND status = 'executing' AND lease_owner = $2 FOR UPDATE`,
        [actionId, workerId],
      )
      const attempt = execution.rows[0]?.attempt
      if (attempt === undefined) throw new Error(`worker ${workerId} does not own action ${actionId}`)
      const actionState = result.status === 'completed' ? 'completed' : result.status === 'needs-input' ? 'waiting-external' : 'failed'
      await executor.query(
        `UPDATE action_execution SET status = $3, result = $4::jsonb, last_error = $5,
           lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE action_id = $1 AND lease_owner = $2`,
        [actionId, workerId, result.status, JSON.stringify(result), result.status === 'failed' ? result.summary : null],
      )
      await executor.query(
        `UPDATE action_record SET state = $2, executor = $3, updated_at = now() WHERE id = $1`,
        [actionId, actionState, result.executor],
      )
      await executor.query(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES ($1, 'executing', $2, 'executor settled durable action', $3::jsonb, $4)`,
        [actionId, actionState, JSON.stringify({ workerId, result }), `${actionId}:settle:${attempt}`],
      )
    })
  }

  async releaseActionClaim(input: ActionClaimRelease): Promise<void> {
    await this.transaction(async (executor) => {
      const execution = await executor.query<{ attempt: number }>(
        `SELECT attempt FROM action_execution
         WHERE action_id = $1 AND status = 'executing' AND lease_owner = $2 FOR UPDATE`,
        [input.actionId, input.workerId],
      )
      const attempt = execution.rows[0]?.attempt
      if (attempt === undefined) throw new Error(`worker ${input.workerId} does not own action ${input.actionId}`)
      const status = input.disposition === 'retry' ? 'pending' : 'failed'
      const actionState = input.disposition === 'retry' ? 'planned' : 'failed'
      await executor.query(
        `UPDATE action_execution SET status = $3, lease_owner = NULL, lease_expires_at = NULL,
           available_at = $4::timestamptz, last_error = $5, updated_at = now()
         WHERE action_id = $1 AND lease_owner = $2`,
        [input.actionId, input.workerId, status, input.availableAt ?? new Date().toISOString(), input.error],
      )
      await executor.query('UPDATE action_record SET state = $2, updated_at = now() WHERE id = $1', [input.actionId, actionState])
      await executor.query(
        `INSERT INTO action_transition (action_id, from_state, to_state, reason, metadata, idempotency_key)
         VALUES ($1, 'executing', $2, $3, $4::jsonb, $5)`,
        [
          input.actionId,
          actionState,
          input.error,
          JSON.stringify({ workerId: input.workerId, disposition: input.disposition, availableAt: input.availableAt }),
          `${input.actionId}:release:${attempt}:${input.disposition}`,
        ],
      )
    })
  }
}

export function createPgPool(config: PoolConfig = {}): InstanceType<typeof Pool> {
  return new Pool({ connectionString: process.env.DATABASE_URL, ...config })
}

export async function migratePostgres(database: SqlExecutor, migrationFile: string): Promise<void> {
  const sql = await readFile(migrationFile, 'utf8')
  await database.query(sql)
}
