import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { eventToPolicySample } from '../policy/samples.js'
import type {
  ActionClaimRelease,
  AdvanceWorkflowInput,
  ActionSummary,
  ApprovalSummary,
  AssistantStore,
  ClaimedAction,
  ClaimedWorkflowEffect,
  CreateWorkflowInput,
  DurableActionInput,
  DurableSignal,
  DurableSignalInput,
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

function sqliteWorkflow(row: Record<string, string | number | null>): WorkflowInstance {
  return {
    id: String(row.id), kind: String(row.kind), definitionVersion: Number(row.definition_version),
    status: String(row.status) as WorkflowInstance['status'],
    state: JSON.parse(String(row.state)) as Record<string, unknown>, revision: Number(row.revision),
    ...(row.wake_at ? { wakeAt: String(row.wake_at) } : {}),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
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

  async createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean; readonly instance: WorkflowInstance }> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const state = canonicalJson(input.state)
      const result = this.database.prepare(
        `INSERT INTO workflow_instance (id, kind, definition_version, status, state, wake_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ).run(input.id, input.kind, input.definitionVersion, input.status, state, input.wakeAt ?? null)
      const row = this.database.prepare('SELECT * FROM workflow_instance WHERE id = ?').get(input.id) as Record<string, string | number | null> | undefined
      if (!row) throw new Error(`workflow ${input.id} was not persisted`)
      if (result.changes === 0 && (row.kind !== input.kind || Number(row.definition_version) !== input.definitionVersion
        || row.status !== input.status || row.state !== state || (row.wake_at ?? null) !== (input.wakeAt ?? null))) {
        throw new Error(`workflow ${input.id} already exists with different durable content`)
      }
      if (result.changes === 0) {
        const effects = this.database.prepare(
          'SELECT id, kind, payload, available_at FROM workflow_effect WHERE instance_id = ? ORDER BY id',
        ).all(input.id) as unknown as Array<{ id: string; kind: string; payload: string; available_at: string }>
        const expected = [...(input.effects ?? [])].sort((left, right) => left.id.localeCompare(right.id))
        const matches = effects.length === expected.length && effects.every((effect, index) => {
          const wanted = expected[index]
          return wanted && effect.id === wanted.id && effect.kind === wanted.kind && effect.payload === canonicalJson(wanted.payload)
            && (wanted.availableAt === undefined || effect.available_at === wanted.availableAt)
        })
        if (!matches) throw new Error(`workflow ${input.id} already exists with different durable effects`)
      }
      if (result.changes === 1) this.insertWorkflowEffects(input.id, input.effects ?? [])
      this.database.exec('COMMIT')
      return { inserted: result.changes === 1, instance: sqliteWorkflow(row) }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async workflow(id: string): Promise<WorkflowInstance | undefined> {
    const row = this.database.prepare('SELECT * FROM workflow_instance WHERE id = ?').get(id) as Record<string, string | number | null> | undefined
    return row ? sqliteWorkflow(row) : undefined
  }

  async dueWorkflows(now: string, limit: number): Promise<readonly WorkflowInstance[]> {
    const rows = this.database.prepare(
      `SELECT * FROM workflow_instance WHERE status IN ('running', 'waiting') AND wake_at IS NOT NULL AND wake_at <= ?
       ORDER BY wake_at, id LIMIT ?`,
    ).all(now, limit) as unknown as Array<Record<string, string | number | null>>
    return rows.map(sqliteWorkflow)
  }

  async advanceWorkflow(input: AdvanceWorkflowInput): Promise<{ readonly advanced: boolean; readonly instance: WorkflowInstance }> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const currentRow = this.database.prepare('SELECT * FROM workflow_instance WHERE id = ?').get(input.instanceId) as Record<string, string | number | null> | undefined
      if (!currentRow) throw new Error(`workflow ${input.instanceId} does not exist`)
      const duplicate = this.database.prepare(
        'SELECT 1 FROM workflow_event WHERE instance_id = ? AND event_id = ?',
      ).get(input.instanceId, input.event.id)
      if (duplicate) {
        this.database.exec('COMMIT')
        return { advanced: false, instance: sqliteWorkflow(currentRow) }
      }
      if (Number(currentRow.revision) !== input.expectedRevision) throw new Error(`workflow ${input.instanceId} revision conflict`)
      const revision = input.expectedRevision + 1
      const state = canonicalJson(input.state)
      const wakeAt = input.wakeAt === undefined ? currentRow.wake_at ?? null : input.wakeAt
      this.database.prepare(
        `INSERT INTO workflow_event (instance_id, event_id, event_type, occurred_at, payload, processed_revision)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.instanceId, input.event.id, input.event.type, input.event.occurredAt, canonicalJson(input.event.payload), revision)
      this.database.prepare(
        `UPDATE workflow_instance SET status = ?, state = ?, revision = ?, wake_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(input.status, state, revision, wakeAt, input.instanceId)
      this.database.prepare(
        `INSERT INTO workflow_transition (instance_id, revision, event_id, from_status, to_status, state)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.instanceId, revision, input.event.id, String(currentRow.status), input.status, state)
      this.insertWorkflowEffects(input.instanceId, input.effects ?? [])
      const updated = this.database.prepare('SELECT * FROM workflow_instance WHERE id = ?').get(input.instanceId) as Record<string, string | number | null>
      this.database.exec('COMMIT')
      return { advanced: true, instance: sqliteWorkflow(updated) }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async claimNextWorkflowEffect(workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedWorkflowEffect | undefined> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const row = this.database.prepare(
        `SELECT id, instance_id, kind, payload, attempt FROM workflow_effect
         WHERE available_at <= ? AND (status = 'pending' OR (status = 'dispatching' AND lease_expires_at <= ?))
         ORDER BY available_at, created_at LIMIT 1`,
      ).get(now, now) as { id: string; instance_id: string; kind: string; payload: string; attempt: number } | undefined
      if (!row) { this.database.exec('COMMIT'); return undefined }
      const attempt = row.attempt + 1
      const result = this.database.prepare(
        `UPDATE workflow_effect SET status = 'dispatching', attempt = ?, lease_owner = ?, lease_expires_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(attempt, workerId, leaseExpiresAt, row.id)
      if (result.changes !== 1) throw new Error(`workflow effect ${row.id} lost its claim race`)
      this.database.exec('COMMIT')
      return { id: row.id, instanceId: row.instance_id, kind: row.kind, payload: JSON.parse(row.payload), attempt }
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  async settleWorkflowEffect(effectId: string, workerId: string, deliveredAt: string): Promise<void> {
    const result = this.database.prepare(
      `UPDATE workflow_effect SET status = 'delivered', delivered_at = ?, lease_owner = NULL, lease_expires_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'dispatching' AND lease_owner = ?`,
    ).run(deliveredAt, effectId, workerId)
    if (result.changes !== 1) throw new Error(`worker ${workerId} does not own workflow effect ${effectId}`)
  }

  async releaseWorkflowEffect(effectId: string, workerId: string, error: string, availableAt: string, terminal: boolean): Promise<void> {
    const result = this.database.prepare(
      `UPDATE workflow_effect SET status = ?, available_at = ?, last_error = ?, lease_owner = NULL, lease_expires_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'dispatching' AND lease_owner = ?`,
    ).run(terminal ? 'failed' : 'pending', availableAt, error, effectId, workerId)
    if (result.changes !== 1) throw new Error(`worker ${workerId} does not own workflow effect ${effectId}`)
  }

  private insertWorkflowEffects(instanceId: string, effects: readonly WorkflowEffectInput[]): void {
    const statement = this.database.prepare(
      `INSERT INTO workflow_effect (id, instance_id, kind, payload, available_at)
       VALUES (?, ?, ?, ?, coalesce(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
    )
    for (const effect of effects) statement.run(effect.id, instanceId, effect.kind, canonicalJson(effect.payload), effect.availableAt ?? null)
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
