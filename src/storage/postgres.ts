import { readFile, readdir } from 'node:fs/promises'
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg'
import pg from 'pg'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type {
  ActionClaimRelease,
  AdvanceWorkflowInput,
  ActionSummary,
  ApprovalSummary,
  AssistantStore,
  ClaimedAction,
  ClaimedChannelEvent,
  ClaimedWorkflowEffect,
  CreateWorkflowInput,
  DurableActionInput,
  DurableSignal,
  DurableSignalInput,
  EventClaimRelease,
  EventSummary,
  MatterSummary,
  OverviewCounts,
  PolicyDraftInput,
  PolicySummary,
  StoredEvent,
  WorkflowEffectInput,
  WorkflowInstance,
} from './types.js'
import type { ExecutorRequest, ExecutorResult } from '../domain/contracts.js'

const { Pool } = pg

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function pgTimestamp(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : value
}

function pgWorkflow(row: Record<string, unknown>): WorkflowInstance {
  return {
    id: String(row.id), kind: String(row.kind), definitionVersion: Number(row.definitionVersion),
    status: String(row.status) as WorkflowInstance['status'], state: row.state as Record<string, unknown>,
    revision: Number(row.revision), ...(pgTimestamp(row.wakeAt as string | Date | null) ? { wakeAt: pgTimestamp(row.wakeAt as string | Date | null)! } : {}),
    createdAt: pgTimestamp(row.createdAt as string | Date)!, updatedAt: pgTimestamp(row.updatedAt as string | Date)!,
  }
}

function pgClaimedEvent(row: Record<string, unknown>): ClaimedChannelEvent {
  return { id: String(row.id), attempt: Number(row.attempt), event: {
    kind: String(row.kind) as NormalizedChannelEvent['kind'],
    source: row.source as NormalizedChannelEvent['source'], eventKey: String(row.eventKey), deduplicationKey: String(row.deduplicationKey),
    payload: row.payload as Record<string, unknown>, raw: row.raw as Record<string, unknown>,
    ...(pgTimestamp(row.occurredAt as string | Date | null) ? { occurredAt: pgTimestamp(row.occurredAt as string | Date | null)! } : {}),
  } }
}

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
           (id, kind, event_key, deduplication_key, source, payload, raw, occurred_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::timestamptz)
         ON CONFLICT (deduplication_key) DO NOTHING
         RETURNING id
       )
       SELECT id, true AS inserted FROM inserted
       UNION ALL
       SELECT id, false AS inserted
       FROM assistant_event
       WHERE deduplication_key = $4 AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [
        id,
        event.kind,
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

  async claimNextEvent(consumerName: string, eventKeys: readonly string[], workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedChannelEvent | undefined> {
    if (!consumerName.trim() || !workerId.trim() || eventKeys.length === 0) throw new Error('event claim requires consumer, worker, and event keys')
    return await this.transaction(async executor => {
      const candidate = await executor.query<Record<string, unknown>>(
        `SELECT e.id, e.kind, e.event_key AS "eventKey", e.deduplication_key AS "deduplicationKey", e.source, e.payload, e.raw,
                e.occurred_at AS "occurredAt"
         FROM assistant_event e LEFT JOIN event_delivery d ON d.consumer_name = $1 AND d.event_id = e.id
         WHERE e.event_key = ANY($2::text[]) AND (
           d.event_id IS NULL OR (d.status = 'pending' AND d.available_at <= $3::timestamptz)
           OR (d.status = 'processing' AND d.lease_expires_at <= $3::timestamptz)
         ) ORDER BY e.received_at, e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1`, [consumerName, eventKeys, now],
      )
      const row = candidate.rows[0]
      if (!row) return undefined
      const delivery = await executor.query<{ attempt: number }>(
        `INSERT INTO event_delivery (consumer_name, event_id, status, attempt, worker_id, lease_expires_at, available_at)
         VALUES ($1, $2, 'processing', 1, $3, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (consumer_name, event_id) DO UPDATE SET status = 'processing', attempt = event_delivery.attempt + 1,
           worker_id = excluded.worker_id, lease_expires_at = excluded.lease_expires_at, updated_at = now()
         WHERE (event_delivery.status = 'pending' AND event_delivery.available_at <= excluded.available_at)
            OR (event_delivery.status = 'processing' AND event_delivery.lease_expires_at <= excluded.available_at)
         RETURNING attempt`, [consumerName, row.id, workerId, leaseExpiresAt, now],
      )
      if (!delivery.rows[0]) return undefined
      return pgClaimedEvent({ ...row, attempt: delivery.rows[0].attempt })
    })
  }

  async settleEvent(consumerName: string, eventId: string, workerId: string, deliveredAt: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE event_delivery SET status = 'delivered', delivered_at = $4::timestamptz, worker_id = NULL,
       lease_expires_at = NULL, updated_at = now() WHERE consumer_name = $1 AND event_id = $2 AND status = 'processing' AND worker_id = $3`,
      [consumerName, eventId, workerId, deliveredAt],
    )
    if (result.rowCount !== 1) throw new Error(`event ${eventId} is not claimed by ${workerId}`)
  }

  async releaseEvent(input: EventClaimRelease): Promise<void> {
    const result = await this.database.query(
      `UPDATE event_delivery SET status = $4, available_at = $5::timestamptz, last_error = $6, worker_id = NULL,
       lease_expires_at = NULL, updated_at = now() WHERE consumer_name = $1 AND event_id = $2 AND status = 'processing' AND worker_id = $3`,
      [input.consumerName, input.eventId, input.workerId, input.terminal ? 'failed' : 'pending', input.availableAt, input.error.slice(0, 4_096)],
    )
    if (result.rowCount !== 1) throw new Error(`event ${input.eventId} is not claimed by ${input.workerId}`)
  }

  async appendSignal(input: DurableSignalInput): Promise<{ readonly inserted: boolean }> {
    const scope = JSON.stringify(input.scope ?? {})
    const data = JSON.stringify(input.data)
    const result = await this.database.query<{ inserted: boolean; matches: boolean }>(
      `WITH inserted AS (
         INSERT INTO assistant_signal (id, kind, occurred_at, scope, data)
         VALUES ($1, $2, $3::timestamptz, $4::jsonb, $5::jsonb)
         ON CONFLICT (id) DO NOTHING RETURNING true AS inserted
       )
       SELECT true AS inserted, true AS matches FROM inserted
       UNION ALL
       SELECT false AS inserted,
         kind = $2 AND occurred_at = $3::timestamptz AND scope = $4::jsonb AND data = $5::jsonb AS matches
       FROM assistant_signal WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [input.id, input.kind, input.occurredAt, scope, data],
    )
    const row = result.rows[0]
    if (!row?.matches) throw new Error(`signal ${input.id} already exists with different durable content`)
    return { inserted: row.inserted }
  }

  async recentSignals(kind: string, limit: number): Promise<readonly DurableSignal[]> {
    const result = await this.database.query<{
      id: string
      kind: string
      occurredAt: string | Date
      scope: Readonly<Record<string, unknown>>
      data: Readonly<Record<string, unknown>>
      recordedAt: string | Date
    }>(
      `SELECT id, kind, occurred_at AS "occurredAt", scope, data, recorded_at AS "recordedAt"
       FROM assistant_signal WHERE kind = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [kind, limit],
    )
    return result.rows.map(row => ({
      ...row,
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : row.occurredAt,
      recordedAt: row.recordedAt instanceof Date ? row.recordedAt.toISOString() : row.recordedAt,
    }))
  }

  async readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    const result = await this.database.query<{ value: Readonly<Record<string, unknown>> }>(
      'SELECT value FROM feature_checkpoint WHERE namespace = $1 AND key = $2',
      [namespace, key],
    )
    return result.rows[0]?.value
  }

  async writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    await this.database.query(
      `INSERT INTO feature_checkpoint (namespace, key, value) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [namespace, key, JSON.stringify(value)],
    )
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean; readonly instance: WorkflowInstance }> {
    return await this.transaction(async executor => {
      const result = await executor.query<Record<string, unknown> & { inserted: boolean }>(
        `WITH inserted AS (
           INSERT INTO workflow_instance (id, kind, definition_version, status, state, wake_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
           ON CONFLICT (id) DO NOTHING RETURNING *, true AS inserted
         )
         SELECT id, kind, definition_version AS "definitionVersion", status, state, revision,
                wake_at AS "wakeAt", created_at AS "createdAt", updated_at AS "updatedAt", inserted FROM inserted
         UNION ALL
         SELECT id, kind, definition_version, status, state, revision, wake_at, created_at, updated_at, false
         FROM workflow_instance WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM inserted) LIMIT 1`,
        [input.id, input.kind, input.definitionVersion, input.status, JSON.stringify(input.state), input.wakeAt ?? null],
      )
      const row = result.rows[0]
      if (!row) throw new Error(`workflow ${input.id} was not persisted`)
      const instance = pgWorkflow(row)
      if (!row.inserted && (instance.kind !== input.kind || instance.definitionVersion !== input.definitionVersion
        || instance.status !== input.status || canonicalJson(instance.state) !== canonicalJson(input.state)
        || (instance.wakeAt ?? null) !== (input.wakeAt ? new Date(input.wakeAt).toISOString() : null))) {
        throw new Error(`workflow ${input.id} already exists with different durable content`)
      }
      if (!row.inserted) {
        const effects = await executor.query<{ id: string; kind: string; payload: Readonly<Record<string, unknown>>; availableAt: string | Date }>(
          `SELECT id, kind, payload, available_at AS "availableAt" FROM workflow_effect WHERE instance_id = $1 ORDER BY id`, [input.id],
        )
        const expected = [...(input.effects ?? [])].sort((left, right) => left.id.localeCompare(right.id))
        const matches = effects.rows.length === expected.length && effects.rows.every((effect, index) => {
          const wanted = expected[index]
          return wanted && effect.id === wanted.id && effect.kind === wanted.kind && canonicalJson(effect.payload) === canonicalJson(wanted.payload)
            && (wanted.availableAt === undefined || pgTimestamp(effect.availableAt) === new Date(wanted.availableAt).toISOString())
        })
        if (!matches) throw new Error(`workflow ${input.id} already exists with different durable effects`)
      }
      if (row.inserted) await this.insertWorkflowEffects(executor, input.id, input.effects ?? [])
      return { inserted: row.inserted, instance }
    })
  }

  async workflow(id: string): Promise<WorkflowInstance | undefined> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT id, kind, definition_version AS "definitionVersion", status, state, revision,
              wake_at AS "wakeAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM workflow_instance WHERE id = $1`, [id],
    )
    return result.rows[0] ? pgWorkflow(result.rows[0]) : undefined
  }

  async dueWorkflows(now: string, limit: number): Promise<readonly WorkflowInstance[]> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT id, kind, definition_version AS "definitionVersion", status, state, revision,
              wake_at AS "wakeAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM workflow_instance WHERE status IN ('running', 'waiting') AND wake_at IS NOT NULL AND wake_at <= $1::timestamptz
       ORDER BY wake_at, id LIMIT $2`, [now, limit],
    )
    return result.rows.map(pgWorkflow)
  }

  async advanceWorkflow(input: AdvanceWorkflowInput): Promise<{ readonly advanced: boolean; readonly instance: WorkflowInstance }> {
    return await this.transaction(async executor => {
      const currentResult = await executor.query<Record<string, unknown>>(
        `SELECT id, kind, definition_version AS "definitionVersion", status, state, revision,
                wake_at AS "wakeAt", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM workflow_instance WHERE id = $1 FOR UPDATE`, [input.instanceId],
      )
      const currentRow = currentResult.rows[0]
      if (!currentRow) throw new Error(`workflow ${input.instanceId} does not exist`)
      const duplicate = await executor.query('SELECT 1 FROM workflow_event WHERE instance_id = $1 AND event_id = $2', [input.instanceId, input.event.id])
      if (duplicate.rows[0]) return { advanced: false, instance: pgWorkflow(currentRow) }
      if (Number(currentRow.revision) !== input.expectedRevision) throw new Error(`workflow ${input.instanceId} revision conflict`)
      const revision = input.expectedRevision + 1
      await executor.query(
        `INSERT INTO workflow_event (instance_id, event_id, event_type, occurred_at, payload, processed_revision)
         VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb, $6)`,
        [input.instanceId, input.event.id, input.event.type, input.event.occurredAt, JSON.stringify(input.event.payload), revision],
      )
      const wakeAt = input.wakeAt === undefined ? currentRow.wakeAt ?? null : input.wakeAt
      const updated = await executor.query<Record<string, unknown>>(
        `UPDATE workflow_instance SET status = $2, state = $3::jsonb, revision = $4, wake_at = $5::timestamptz, updated_at = now()
         WHERE id = $1 RETURNING id, kind, definition_version AS "definitionVersion", status, state, revision,
         wake_at AS "wakeAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.instanceId, input.status, JSON.stringify(input.state), revision, wakeAt],
      )
      await executor.query(
        `INSERT INTO workflow_transition (instance_id, revision, event_id, from_status, to_status, state)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [input.instanceId, revision, input.event.id, currentRow.status, input.status, JSON.stringify(input.state)],
      )
      await this.insertWorkflowEffects(executor, input.instanceId, input.effects ?? [])
      return { advanced: true, instance: pgWorkflow(updated.rows[0]!) }
    })
  }

  async claimNextWorkflowEffect(workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedWorkflowEffect | undefined> {
    return await this.transaction(async executor => {
      const result = await executor.query<{
        id: string; instanceId: string; kind: string; payload: Readonly<Record<string, unknown>>; attempt: number
      }>(
        `WITH candidate AS (
           SELECT id FROM workflow_effect
           WHERE available_at <= $1::timestamptz AND (status = 'pending' OR (status = 'dispatching' AND lease_expires_at <= $1::timestamptz))
           ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE workflow_effect effect SET status = 'dispatching', attempt = effect.attempt + 1,
           lease_owner = $2, lease_expires_at = $3::timestamptz, updated_at = now()
         FROM candidate WHERE effect.id = candidate.id
         RETURNING effect.id, effect.instance_id AS "instanceId", effect.kind, effect.payload, effect.attempt`,
        [now, workerId, leaseExpiresAt],
      )
      return result.rows[0]
    })
  }

  async settleWorkflowEffect(effectId: string, workerId: string, deliveredAt: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE workflow_effect SET status = 'delivered', delivered_at = $3::timestamptz,
       lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'dispatching' AND lease_owner = $2`, [effectId, workerId, deliveredAt],
    )
    if (result.rowCount !== 1) throw new Error(`worker ${workerId} does not own workflow effect ${effectId}`)
  }

  async releaseWorkflowEffect(effectId: string, workerId: string, error: string, availableAt: string, terminal: boolean): Promise<void> {
    const result = await this.database.query(
      `UPDATE workflow_effect SET status = $3, available_at = $4::timestamptz, last_error = $5,
       lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'dispatching' AND lease_owner = $2`,
      [effectId, workerId, terminal ? 'failed' : 'pending', availableAt, error],
    )
    if (result.rowCount !== 1) throw new Error(`worker ${workerId} does not own workflow effect ${effectId}`)
  }

  private async insertWorkflowEffects(executor: SqlExecutor, instanceId: string, effects: readonly WorkflowEffectInput[]): Promise<void> {
    for (const effect of effects) {
      await executor.query(
        `INSERT INTO workflow_effect (id, instance_id, kind, payload, available_at)
         VALUES ($1, $2, $3, $4::jsonb, coalesce($5::timestamptz, now()))`,
        [effect.id, instanceId, effect.kind, JSON.stringify(effect.payload), effect.availableAt ?? null],
      )
    }
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
      `SELECT id, kind, event_key AS "eventKey", deduplication_key AS "deduplicationKey",
              source, occurred_at AS "occurredAt", received_at AS "receivedAt"
       FROM assistant_event ORDER BY received_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows
  }

  async recentEventPayloads(kind: string, limit: number) {
    const result = await this.database.query<{ id: string; source: Record<string, unknown>; payload: Record<string, unknown> }>(
      `SELECT id, source, payload FROM assistant_event
       WHERE kind = $1
       ORDER BY received_at DESC LIMIT $2`,
      [kind, limit],
    )
    return result.rows
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
          `UPDATE action_execution SET status = 'failed', last_error = 'approval rejected', updated_at = now()
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
          `approval ${decision} action`,
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
                (a.approval_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM approval_request granted
                  WHERE granted.id = a.approval_id AND granted.action_id = a.id AND granted.status = 'approved'
                )) AS "approvalGranted", a.state
         FROM action_execution e
         JOIN action_record a ON a.id = e.action_id
         WHERE e.request ->> 'workspace' = $1
           AND e.available_at <= $2::timestamptz
           AND (e.status = 'pending' OR (e.status = 'executing' AND e.lease_expires_at <= $2::timestamptz))
           AND (a.approval_id IS NULL OR EXISTS (
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
