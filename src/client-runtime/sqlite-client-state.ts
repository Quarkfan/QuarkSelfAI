import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CapabilityLifecycleSnapshotV1 } from '../capability-platform/manifest.js'
import { WorkspacePolicy } from '../execution/workspace-policy.js'
import type { DeviceEnrollmentRequestV1 } from '../control-plane/contracts.js'
import type { DeviceIdentityV1, ExecutorCapabilityReportV1, InactiveCapabilityRemovalV1, InactiveCapabilitySelectionV1, LocalDeviceEnrollmentStateV1, PlanSignatureVerifierV1 } from './contracts.js'
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

export interface LocalClientEnrollmentV1 { readonly identity: DeviceIdentityV1; readonly privateKeyRef: string }
export interface LocalIntakeMatterInputV1 {
  readonly tenantId: string
  readonly userId: string
  readonly sourceId: string
  readonly idempotencyKey: string
  readonly title: string
  readonly summary: string
  readonly priority: 1 | 3 | 5
  readonly tags: readonly string[]
  readonly dueAt?: string
  readonly existingMatterId?: string
}
export interface LocalIntakeMatterV1 {
  readonly matterId: string
  readonly tenantId: string
  readonly userId: string
  readonly status: 'open' | 'waiting' | 'completed' | 'ignored' | 'superseded'
  readonly title: string
  readonly summary: string
  readonly priority: 1 | 3 | 5
  readonly tags: readonly string[]
  readonly dueAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}
/** Local-only durable state. Secret references and canonical paths never enter its cloud projection. */
export class SqliteInactiveClientStateV1 {
  constructor(private readonly db: DatabaseSync, private readonly planVerifier: PlanSignatureVerifierV1) {}

  enroll(identityInput: DeviceIdentityV1, privateKeyRef: string): DeviceIdentityV1 {
    const identity = validateDeviceIdentity(identityInput)
    if (!referencePattern.test(privateKeyRef)) throw new Error('inactive client enrollment requires an opaque local key reference')
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

  isEnrolled(): boolean { return Boolean(this.#identityRow()) }

  /** Local-only and inactive: a Matter write never creates an executable action or an external task. */
  upsertIntakeMatter(input: LocalIntakeMatterInputV1, now = new Date()): { readonly matter: LocalIntakeMatterV1; readonly inserted: boolean; readonly changed: boolean } {
    const identity = this.#requireIdentity()
    if (input.tenantId !== identity.tenantId || input.userId !== identity.userId) throw new Error('intake matter scope does not match enrolled client')
    if (input.existingMatterId !== undefined) throw new Error('explicit Matter merge requires separate reconciliation')
    if (!input.sourceId?.trim() || input.sourceId.length > 500 || !input.idempotencyKey?.trim() || input.idempotencyKey.length > 1000
      || !input.title?.trim() || input.title.length > 300 || !input.summary?.trim() || input.summary.length > 5000
      || ![1, 3, 5].includes(input.priority) || !Array.isArray(input.tags) || input.tags.length > 20
      || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 64)
      || (input.dueAt !== undefined && Number.isNaN(Date.parse(input.dueAt))) || Number.isNaN(now.getTime())) {
      throw new Error('intake matter input is invalid')
    }
    const fingerprint = sha256(`feishu:${input.sourceId}`)
    const idempotencyFingerprint = sha256(input.idempotencyKey)
    const digest = sha256(JSON.stringify([fingerprint, input.title, input.summary, input.priority, input.tags, input.dueAt ?? null]))
    const matterId = `matter.${sha256(`${identity.tenantId}:${identity.userId}:${fingerprint}`).slice(0, 32)}`
    const at = now.toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const prior = this.db.prepare('SELECT request_digest, matter_id FROM local_matter_intake WHERE tenant_id=? AND user_id=? AND idempotency_fingerprint=?')
        .get(identity.tenantId, identity.userId, idempotencyFingerprint) as Row | undefined
      if (prior) {
        if (prior.request_digest !== digest) throw new Error('intake idempotency key has different durable content')
        const matter = this.intakeMatter(input.tenantId, input.userId, String(prior.matter_id))
        if (!matter) throw new Error('intake receipt lost its Matter')
        this.db.exec('COMMIT')
        return { matter, inserted: false, changed: false }
      }
      const existing = this.db.prepare('SELECT * FROM local_matter WHERE tenant_id=? AND user_id=? AND source_fingerprint=?')
        .get(identity.tenantId, identity.userId, fingerprint) as Row | undefined
      if (existing && existing.status !== 'open' && existing.status !== 'waiting') throw new Error('terminal Matter cannot be reopened implicitly')
      const tagsJson = JSON.stringify(input.tags)
      const changed = !existing || existing.title !== input.title || existing.summary !== input.summary
        || Number(existing.priority) !== input.priority || existing.tags_json !== tagsJson || existing.due_at !== (input.dueAt ?? null)
      if (!existing) {
        this.db.prepare(`INSERT INTO local_matter (matter_id,tenant_id,user_id,source_fingerprint,status,title,summary,priority,tags_json,due_at,created_at,updated_at)
          VALUES (?,?,?,?,'open',?,?,?,?,?,?,?)`).run(matterId, identity.tenantId, identity.userId, fingerprint,
          input.title, input.summary, input.priority, tagsJson, input.dueAt ?? null, at, at)
      } else if (changed) {
        this.db.prepare(`UPDATE local_matter SET title=?,summary=?,priority=?,tags_json=?,due_at=?,updated_at=? WHERE matter_id=? AND tenant_id=? AND user_id=?`)
          .run(input.title, input.summary, input.priority, tagsJson, input.dueAt ?? null, at, String(existing.matter_id), identity.tenantId, identity.userId)
      }
      const selectedId = existing ? String(existing.matter_id) : matterId
      this.db.prepare('INSERT INTO local_matter_intake (tenant_id,user_id,idempotency_fingerprint,request_digest,matter_id,recorded_at) VALUES (?,?,?,?,?,?)')
        .run(identity.tenantId, identity.userId, idempotencyFingerprint, digest, selectedId, at)
      const matter = this.intakeMatter(input.tenantId, input.userId, selectedId)
      if (!matter) throw new Error('intake Matter write was not readable')
      this.db.exec('COMMIT')
      return { matter, inserted: !existing, changed }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  intakeMatter(tenantId: string, userId: string, matterId: string): LocalIntakeMatterV1 | null {
    const identity = this.#requireIdentity()
    if (tenantId !== identity.tenantId || userId !== identity.userId) throw new Error('intake Matter read is outside enrolled scope')
    const row = this.db.prepare('SELECT * FROM local_matter WHERE matter_id=? AND tenant_id=? AND user_id=?')
      .get(matterId, tenantId, userId) as Row | undefined
    if (!row) return null
    const value: LocalIntakeMatterV1 = {
      matterId: String(row.matter_id), tenantId: String(row.tenant_id), userId: String(row.user_id),
      status: String(row.status) as LocalIntakeMatterV1['status'], title: String(row.title), summary: String(row.summary),
      priority: Number(row.priority) as LocalIntakeMatterV1['priority'], tags: JSON.parse(String(row.tags_json)) as string[],
      ...(row.due_at ? { dueAt: String(row.due_at) } : {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
    if (value.tenantId !== identity.tenantId || value.userId !== identity.userId || ![1, 3, 5].includes(value.priority)
      || !Array.isArray(value.tags) || Number.isNaN(Date.parse(value.createdAt)) || Number.isNaN(Date.parse(value.updatedAt))) {
      throw new Error('persisted intake Matter is invalid')
    }
    return deepFreeze(value)
  }

  /** Local-runtime access only. Callers must never include the returned reference in cloud payloads. */
  localEnrollment(): LocalClientEnrollmentV1 {
    const row = this.#identityRow()
    if (!row || !referencePattern.test(String(row.private_key_ref))) throw new Error('local client is not enrolled')
    return deepFreeze({ identity: this.#identity(row), privateKeyRef: String(row.private_key_ref) })
  }

  savePendingDeviceEnrollment(request: DeviceEnrollmentRequestV1, pollTokenRef: string, now = new Date()): LocalDeviceEnrollmentStateV1 {
    const identity = this.#requireIdentity()
    if (Number.isNaN(now.getTime()) || !/^enrollment\.[a-f0-9]{32}$/.test(request.requestId) || !/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(request.userCode) || !referencePattern.test(pollTokenRef) || request.verificationPath !== '/devices/activate' || request.pollAfterSeconds !== 5 || Date.parse(request.expiresAt) <= now.getTime()) throw new Error('local device enrollment request is invalid')
    if (this.deviceEnrollment()) throw new Error('local device enrollment already exists')
    this.db.prepare(`INSERT INTO local_device_enrollment (singleton,request_id,device_id,user_code,poll_token_ref,state,expires_at,poll_after_seconds,updated_at) VALUES (1,?,?,?,?, 'pending',?,?,?)`)
      .run(request.requestId, identity.deviceId, request.userCode, pollTokenRef, request.expiresAt, request.pollAfterSeconds, now.toISOString())
    return this.deviceEnrollment()!
  }

  deviceEnrollment(): LocalDeviceEnrollmentStateV1 | null {
    const identity = this.#requireIdentity()
    const row = this.db.prepare('SELECT * FROM local_device_enrollment WHERE singleton=1').get() as Row | undefined
    if (!row) return null
    const value = { requestId: String(row.request_id), deviceId: String(row.device_id), userCode: String(row.user_code), pollTokenRef: String(row.poll_token_ref), state: String(row.state), expiresAt: String(row.expires_at), pollAfterSeconds: Number(row.poll_after_seconds), updatedAt: String(row.updated_at) } as LocalDeviceEnrollmentStateV1
    if (value.deviceId !== identity.deviceId || !/^enrollment\.[a-f0-9]{32}$/.test(value.requestId) || !/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(value.userCode) || !referencePattern.test(value.pollTokenRef) || !['pending','approved-cleanup-pending','approved','expired-cleanup-pending','expired'].includes(value.state) || value.pollAfterSeconds !== 5 || Number.isNaN(Date.parse(value.expiresAt)) || Number.isNaN(Date.parse(value.updatedAt))) throw new Error('persisted local device enrollment is invalid')
    return deepFreeze(value)
  }

  advanceDeviceEnrollment(requestId: string, state: 'approved-cleanup-pending' | 'approved' | 'expired-cleanup-pending' | 'expired', now = new Date()): LocalDeviceEnrollmentStateV1 {
    const current = this.deviceEnrollment()
    if (!current || current.requestId !== requestId || Number.isNaN(now.getTime())) throw new Error('local device enrollment is unavailable')
    const allowed = current.state === 'pending' ? [`approved-cleanup-pending`, `expired-cleanup-pending`] : current.state === 'approved-cleanup-pending' ? ['approved'] : current.state === 'expired-cleanup-pending' ? ['expired'] : []
    if (!allowed.includes(state)) throw new Error('local device enrollment transition is invalid')
    this.db.prepare('UPDATE local_device_enrollment SET state=?, updated_at=? WHERE singleton=1').run(state, now.toISOString())
    return this.deviceEnrollment()!
  }

  clearExpiredDeviceEnrollment(): void {
    const current = this.deviceEnrollment()
    if (!current || current.state !== 'expired') throw new Error('only a fully cleaned expired device enrollment can be cleared')
    this.db.prepare(`DELETE FROM local_device_enrollment WHERE singleton=1 AND state='expired'`).run()
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

  inactiveCapability(capabilityId: string, version: string): CapabilityLifecycleSnapshotV1 | null {
    const identity = this.#requireIdentity()
    if (!idPattern.test(capabilityId) || !versionPattern.test(version)) throw new Error('inactive capability identity is invalid')
    const row = this.db.prepare(`SELECT * FROM local_capability_state WHERE capability_id=? AND version=?`).get(capabilityId, version) as Row | undefined
    if (!row) return null
    const snapshot = JSON.parse(String(row.state_json)) as CapabilityLifecycleSnapshotV1
    if (!isInactiveSnapshot(snapshot, identity) || snapshot.capabilityId !== row.capability_id || snapshot.version !== row.version || snapshot.deviceId !== row.device_id || snapshot.updatedAt !== row.updated_at) throw new Error('persisted inactive capability state drifted')
    return deepFreeze(snapshot)
  }

  inactiveCapabilities(): readonly CapabilityLifecycleSnapshotV1[] {
    this.#requireIdentity()
    const rows = this.db.prepare(`SELECT capability_id, version FROM local_capability_state ORDER BY capability_id, version`).all() as unknown as Row[]
    return deepFreeze(rows.map(row => {
      const value = this.inactiveCapability(String(row.capability_id), String(row.version))
      if (!value) throw new Error('persisted inactive capability index drifted')
      return value
    }))
  }

  inactiveCapabilitySelection(capabilityId: string): InactiveCapabilitySelectionV1 | null {
    this.#requireIdentity()
    if (!idPattern.test(capabilityId)) throw new Error('inactive capability identity is invalid')
    const row = this.db.prepare(`SELECT * FROM local_capability_selection WHERE capability_id=?`).get(capabilityId) as Row | undefined
    if (!row) return null
    const value = { capabilityId, currentVersion: String(row.current_version), previousVersion: row.previous_version === null ? null : String(row.previous_version), updatedAt: String(row.updated_at) }
    if (!versionPattern.test(value.currentVersion) || (value.previousVersion !== null && !versionPattern.test(value.previousVersion)) || Number.isNaN(Date.parse(value.updatedAt)) || !this.inactiveCapability(capabilityId, value.currentVersion) || (value.previousVersion !== null && !this.inactiveCapability(capabilityId, value.previousVersion))) throw new Error('persisted inactive capability selection drifted')
    return deepFreeze(value)
  }

  selectInactiveCapability(capabilityId: string, version: string, now = new Date()): InactiveCapabilitySelectionV1 {
    const selected = this.inactiveCapability(capabilityId, version)
    if (!selected || Number.isNaN(now.getTime())) throw new Error('only an installed inactive capability version can be selected')
    const current = this.inactiveCapabilitySelection(capabilityId)
    if (current?.currentVersion === version) return current
    this.db.prepare(`INSERT INTO local_capability_selection (capability_id, current_version, previous_version, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (capability_id) DO UPDATE SET current_version=excluded.current_version, previous_version=local_capability_selection.current_version, updated_at=excluded.updated_at`)
      .run(capabilityId, version, current?.currentVersion ?? null, now.toISOString())
    return this.inactiveCapabilitySelection(capabilityId)!
  }

  rollbackInactiveCapability(capabilityId: string, now = new Date()): InactiveCapabilitySelectionV1 {
    const current = this.inactiveCapabilitySelection(capabilityId)
    if (!current?.previousVersion || Number.isNaN(now.getTime())) throw new Error('inactive capability has no rollback version')
    if (!this.inactiveCapability(capabilityId, current.previousVersion)) throw new Error('inactive capability rollback target is not installed')
    this.db.prepare(`UPDATE local_capability_selection SET current_version=?, previous_version=?, updated_at=? WHERE capability_id=?`)
      .run(current.previousVersion, current.currentVersion, now.toISOString(), capabilityId)
    return this.inactiveCapabilitySelection(capabilityId)!
  }

  removeInactiveCapability(capabilityId: string, version: string, now = new Date()): InactiveCapabilityRemovalV1 {
    const removed = this.inactiveCapability(capabilityId, version)
    if (!removed || Number.isNaN(now.getTime())) throw new Error('inactive capability version is not installed')
    const selection = this.inactiveCapabilitySelection(capabilityId)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (selection?.currentVersion === version) {
        if (selection.previousVersion) this.db.prepare(`UPDATE local_capability_selection SET current_version=?, previous_version=NULL, updated_at=? WHERE capability_id=?`).run(selection.previousVersion, now.toISOString(), capabilityId)
        else this.db.prepare(`DELETE FROM local_capability_selection WHERE capability_id=?`).run(capabilityId)
      } else if (selection?.previousVersion === version) {
        this.db.prepare(`UPDATE local_capability_selection SET previous_version=NULL, updated_at=? WHERE capability_id=?`).run(now.toISOString(), capabilityId)
      }
      this.db.prepare(`DELETE FROM local_capability_state WHERE capability_id=? AND version=?`).run(capabilityId, version)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return deepFreeze({ removed, selection: this.inactiveCapabilitySelection(capabilityId) })
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
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function isInactiveSnapshot(state: CapabilityLifecycleSnapshotV1, identity: DeviceIdentityV1): boolean {
  return idPattern.test(state.capabilityId) && versionPattern.test(state.version) && digestPattern.test(state.artifactDigest) && !Number.isNaN(Date.parse(state.updatedAt)) && state.deviceId === identity.deviceId && state.installation === 'installed' && state.loading === 'unloaded' && state.authorization === 'unauthorized' && state.execution === 'stopped' && state.effects === 'disabled'
}
