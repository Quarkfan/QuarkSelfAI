import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CapabilityLifecycleSnapshotV1 } from '../capability-platform/manifest.js'
import { WorkspacePolicy } from '../execution/workspace-policy.js'
import type { DeviceIdentityV1, ExecutorCapabilityReportV1, PlanSignatureVerifierV1 } from './contracts.js'
import { validateDeviceIdentity, validateExecutorCapabilityReport } from './validation.js'
import { InactiveLocalRunJournalV1, type InactiveLocalRunCheckpointV1 } from './inactive-run-journal.js'

type Row = Record<string, string | number | null>
const referencePattern = /^(?:secret|keychain):[a-z0-9][a-z0-9._:-]{0,127}$/
const handlePattern = /^workspace:[a-z0-9][a-z0-9._:-]{0,127}$/
const idPattern = /^[a-z0-9][a-z0-9./-]{0,127}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface LocalClientCloudProjectionV1 {
  readonly schemaVersion: 1
  readonly identity: DeviceIdentityV1
  readonly executorReports: readonly ExecutorCapabilityReportV1[]
  readonly workspaceHandleCount: number
  readonly installedCapabilityCount: number
  readonly activeCapabilityCount: 0
  readonly pendingResultCount: number
  readonly connection: 'disconnected'
  readonly ownedConsumers: 0
  readonly ownedProviders: 0
  readonly ownedSchedulers: 0
  readonly externalWritesEnabled: false
}

/** Local-only durable state. Secret references and canonical paths never enter its cloud projection. */
export class SqliteInactiveClientStateV1 {
  constructor(private readonly db: DatabaseSync, private readonly planVerifier: PlanSignatureVerifierV1) {}

  enroll(identityInput: DeviceIdentityV1, privateKeyRef: string): DeviceIdentityV1 {
    const identity = validateDeviceIdentity(identityInput)
    if (!identity.tenantId.startsWith('test.') || !referencePattern.test(privateKeyRef)) throw new Error('inactive client enrollment requires a test identity and opaque local key reference')
    const existing = this.#identityRow()
    if (existing) {
      const value = this.#identity(existing)
      if (JSON.stringify(value) !== JSON.stringify(identity) || existing.private_key_ref !== privateKeyRef) throw new Error('local device enrollment is immutable')
      return value
    }
    this.db.prepare(`INSERT INTO local_device_identity (singleton, tenant_id, user_id, device_id, identity_json, private_key_ref, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)`)
      .run(identity.tenantId, identity.userId, identity.deviceId, JSON.stringify(identity), privateKeyRef, identity.createdAt)
    return deepFreeze(structuredClone(identity))
  }

  async registerWorkspace(input: { readonly handle: string; readonly root: string; readonly access: 'read' | 'read-write'; readonly grantId: string; readonly expiresAt: string }): Promise<void> {
    this.#requireIdentity()
    if (!handlePattern.test(input.handle) || !idPattern.test(input.grantId) || !['read', 'read-write'].includes(input.access) || Number.isNaN(Date.parse(input.expiresAt))) throw new Error('local workspace grant is invalid')
    const policy = await WorkspacePolicy.create([input.root])
    const canonical = await policy.authorizeExisting(input.root)
    const existing = this.db.prepare(`SELECT * FROM local_workspace WHERE handle=?`).get(input.handle) as Row | undefined
    if (existing && (existing.canonical_root !== canonical || existing.access !== input.access || existing.grant_id !== input.grantId || existing.expires_at !== input.expiresAt)) throw new Error('local workspace handle is immutable')
    this.db.prepare(`INSERT OR IGNORE INTO local_workspace (handle, canonical_root, access, grant_id, expires_at) VALUES (?, ?, ?, ?, ?)`).run(input.handle, canonical, input.access, input.grantId, input.expiresAt)
  }

  async resolveWorkspace(handle: string, now = new Date()): Promise<{ readonly canonicalRoot: string; readonly access: 'read' | 'read-write'; readonly grantId: string }> {
    if (!handlePattern.test(handle)) throw new Error('workspace handle is invalid')
    const row = this.db.prepare(`SELECT * FROM local_workspace WHERE handle=?`).get(handle) as Row | undefined
    if (!row || Date.parse(String(row.expires_at)) <= now.getTime()) throw new Error('workspace grant is unavailable or expired')
    const storedRoot = String(row.canonical_root)
    const currentRoot = await realpath(storedRoot)
    if (currentRoot !== storedRoot) throw new Error('workspace root identity changed after authorization')
    const policy = await WorkspacePolicy.create([storedRoot])
    const canonicalRoot = await policy.authorizeExisting(storedRoot)
    return Object.freeze({ canonicalRoot, access: String(row.access) as 'read' | 'read-write', grantId: String(row.grant_id) })
  }

  saveExecutorReport(reportInput: ExecutorCapabilityReportV1): ExecutorCapabilityReportV1 {
    const identity = this.#requireIdentity()
    const report = validateExecutorCapabilityReport(reportInput)
    if (report.deviceId !== identity.deviceId) throw new Error('executor report belongs to another device')
    this.db.prepare(`INSERT INTO local_executor_report (executor_id, device_id, report_json, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (executor_id) DO UPDATE SET device_id=excluded.device_id, report_json=excluded.report_json, expires_at=excluded.expires_at`)
      .run(report.executorId, report.deviceId, JSON.stringify(report), report.expiresAt)
    return deepFreeze(structuredClone(report))
  }

  saveInactiveCapability(state: CapabilityLifecycleSnapshotV1): CapabilityLifecycleSnapshotV1 {
    const identity = this.#requireIdentity()
    if (!idPattern.test(state.capabilityId) || !versionPattern.test(state.version) || !digestPattern.test(state.artifactDigest) || Number.isNaN(Date.parse(state.updatedAt)) || state.deviceId !== identity.deviceId || state.installation !== 'installed' || state.loading !== 'unloaded' || state.authorization !== 'unauthorized' || state.execution !== 'stopped' || state.effects !== 'disabled') throw new Error('client accepts installed-inactive capability state only')
    const existing = this.db.prepare(`SELECT state_json FROM local_capability_state WHERE capability_id=? AND version=?`).get(state.capabilityId, state.version) as Row | undefined
    if (existing && JSON.stringify(JSON.parse(String(existing.state_json))) !== JSON.stringify(state)) throw new Error('inactive capability state is immutable')
    this.db.prepare(`INSERT OR IGNORE INTO local_capability_state (capability_id, version, device_id, state_json, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(state.capabilityId, state.version, state.deviceId, JSON.stringify(state), state.updatedAt)
    return deepFreeze(structuredClone(state))
  }

  async saveRunCheckpoint(checkpoint: InactiveLocalRunCheckpointV1, now = new Date()): Promise<InactiveLocalRunCheckpointV1> {
    const identity = this.#requireIdentity()
    if (checkpoint.deviceId !== identity.deviceId) throw new Error('run checkpoint belongs to another device')
    await InactiveLocalRunJournalV1.restore([checkpoint], this.planVerifier, now)
    const existing = this.db.prepare(`SELECT revision, checkpoint_digest FROM local_run_checkpoint WHERE task_id=?`).get(checkpoint.taskId) as Row | undefined
    if (existing && Number(existing.revision) === checkpoint.revision && existing.checkpoint_digest === checkpoint.checkpointDigest) return deepFreeze(structuredClone(checkpoint))
    if (existing && Number(existing.revision) >= checkpoint.revision) throw new Error('run checkpoint revision must advance monotonically')
    this.db.prepare(`INSERT INTO local_run_checkpoint (task_id, device_id, revision, checkpoint_digest, checkpoint_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (task_id) DO UPDATE SET device_id=excluded.device_id, revision=excluded.revision, checkpoint_digest=excluded.checkpoint_digest, checkpoint_json=excluded.checkpoint_json, updated_at=excluded.updated_at`)
      .run(checkpoint.taskId, checkpoint.deviceId, checkpoint.revision, checkpoint.checkpointDigest, JSON.stringify(checkpoint), checkpoint.updatedAt)
    return deepFreeze(structuredClone(checkpoint))
  }

  async restoreRunJournal(now = new Date()): Promise<InactiveLocalRunJournalV1> {
    this.#requireIdentity()
    const rows = this.db.prepare(`SELECT checkpoint_json FROM local_run_checkpoint ORDER BY task_id`).all() as unknown as Row[]
    return await InactiveLocalRunJournalV1.restore(rows.map(row => JSON.parse(String(row.checkpoint_json)) as InactiveLocalRunCheckpointV1), this.planVerifier, now)
  }

  cloudProjection(now = new Date()): LocalClientCloudProjectionV1 {
    const identity = this.#requireIdentity()
    if (Number.isNaN(now.getTime())) throw new Error('projection timestamp is invalid')
    const executorRows = this.db.prepare(`SELECT report_json FROM local_executor_report WHERE expires_at > ? ORDER BY executor_id`).all(now.toISOString()) as unknown as Row[]
    const executorReports = executorRows.map(row => validateExecutorCapabilityReport(JSON.parse(String(row.report_json))))
    const scalar = (sql: string) => Number((this.db.prepare(sql).get() as Row).count)
    const workspaceHandleCount = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM local_workspace WHERE expires_at > ?`).get(now.toISOString()) as Row).count)
    return deepFreeze({ schemaVersion: 1, identity, executorReports, workspaceHandleCount,
      installedCapabilityCount: scalar('SELECT COUNT(*) AS count FROM local_capability_state'), activeCapabilityCount: 0,
      pendingResultCount: scalar("SELECT COUNT(*) AS count FROM local_run_checkpoint WHERE json_extract(checkpoint_json, '$.state') = 'completed-pending-sync'"),
      connection: 'disconnected', ownedConsumers: 0, ownedProviders: 0, ownedSchedulers: 0, externalWritesEnabled: false })
  }

  async close(): Promise<void> { this.db.close() }

  #identityRow(): Row | undefined { return this.db.prepare(`SELECT * FROM local_device_identity WHERE singleton=1`).get() as Row | undefined }
  #requireIdentity(): DeviceIdentityV1 { const row = this.#identityRow(); if (!row) throw new Error('local client is not enrolled'); return this.#identity(row) }
  #identity(row: Row): DeviceIdentityV1 {
    if (!referencePattern.test(String(row.private_key_ref))) throw new Error('persisted local key reference is invalid')
    const identity = validateDeviceIdentity(JSON.parse(String(row.identity_json)))
    if (identity.tenantId !== row.tenant_id || identity.userId !== row.user_id || identity.deviceId !== row.device_id) throw new Error('persisted local device identity drifted')
    return deepFreeze(structuredClone(identity))
  }
}

export async function openSqliteInactiveClientState(databasePath: string, migrationPath: string, verifier: PlanSignatureVerifierV1): Promise<SqliteInactiveClientStateV1> {
  const path = resolve(databasePath); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const db = new DatabaseSync(path)
  try { db.exec(await readFile(resolve(migrationPath), 'utf8')); return new SqliteInactiveClientStateV1(db, verifier) }
  catch (error) { db.close(); throw error }
}

function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }
