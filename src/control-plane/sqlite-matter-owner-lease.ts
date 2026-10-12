import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

type Row = Record<string, string | number | null>
const namespacePattern = /^[a-z][a-z0-9.-]{0,63}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/

export interface MatterOwnerLeaseV1 {
  readonly tenantId: string
  readonly userId: string
  readonly namespace: string
  readonly deviceId: string
  readonly epoch: number
  readonly expiresAt: string
}

export interface MatterOwnerTransferInputV1 {
  readonly expectedEpoch: number
  readonly recoveryDigest: string
  readonly approvalDigest: string
}

/** A real implementation must verify exact owner approval and a recoverable encrypted state snapshot. */
export interface MatterOwnerRecoveryVerifierV1 {
  verify(input: MatterOwnerTransferInputV1 & MatterOwnerLeaseV1 & { readonly targetDeviceId: string }): Promise<boolean>
}

/** Inactive coordination primitive; no HTTP route, Client binding or production transfer verifier. */
export class SqliteInactiveMatterOwnerLeaseV1 {
  constructor(private readonly db: DatabaseSync, private readonly recovery: MatterOwnerRecoveryVerifierV1, private readonly clock: () => Date = () => new Date()) {}

  claim(sessionId: string, namespace: string, expectedEpoch: number | undefined, now = new Date(), ttlMs = 60_000): MatterOwnerLeaseV1 {
    const at = timestamp(now); scope(namespace); ttl(ttlMs)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const session = this.#session(sessionId, now)
      const row = this.#row(session, namespace)
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
      if (!row) {
        if (expectedEpoch !== undefined) throw new Error('Matter owner epoch is unavailable')
        this.db.prepare(`INSERT INTO cp_matter_owner_lease (tenant_id,user_id,namespace,device_id,epoch,lease_expires_at,updated_at) VALUES (?,?,?,?,1,?,?)`)
          .run(session.tenantId, session.userId, namespace, session.deviceId, expiresAt, at)
        this.db.exec('COMMIT')
        return Object.freeze({ ...session, namespace, epoch: 1, expiresAt })
      }
      if (row.device_id !== session.deviceId || row.epoch !== expectedEpoch) throw new Error('Matter owner belongs to another device or epoch')
      this.db.prepare(`UPDATE cp_matter_owner_lease SET lease_expires_at=?,released_at=NULL,updated_at=? WHERE tenant_id=? AND user_id=? AND namespace=?`)
        .run(expiresAt, at, session.tenantId, session.userId, namespace)
      this.db.exec('COMMIT')
      return Object.freeze({ ...session, namespace, epoch: Number(row.epoch), expiresAt })
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  verifyCurrent(sessionId: string, namespace: string, expectedEpoch: number, now = new Date()): boolean {
    scope(namespace); epoch(expectedEpoch)
    const session = this.#session(sessionId, now)
    const row = this.#row(session, namespace)
    return Boolean(row && row.device_id === session.deviceId && row.epoch === expectedEpoch && row.released_at === null && Date.parse(String(row.lease_expires_at)) > now.getTime())
  }

  release(sessionId: string, namespace: string, expectedEpoch: number, now = new Date()): void {
    const at = timestamp(now); scope(namespace); epoch(expectedEpoch)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const session = this.#session(sessionId, now)
      const row = this.#row(session, namespace)
      if (!row || row.device_id !== session.deviceId || row.epoch !== expectedEpoch || row.released_at !== null) throw new Error('Matter owner release is out of scope')
      this.db.prepare(`UPDATE cp_matter_owner_lease SET released_at=?,lease_expires_at=?,updated_at=? WHERE tenant_id=? AND user_id=? AND namespace=?`)
        .run(at, at, at, session.tenantId, session.userId, namespace)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  async transfer(sessionId: string, namespace: string, input: MatterOwnerTransferInputV1, now = new Date(), ttlMs = 60_000): Promise<MatterOwnerLeaseV1> {
    timestamp(now); scope(namespace); ttl(ttlMs); epoch(input.expectedEpoch)
    if (!digestPattern.test(input.recoveryDigest) || !digestPattern.test(input.approvalDigest)) throw new Error('Matter transfer evidence digest is invalid')
    const target = this.#session(sessionId, now)
    const prior = this.#row(target, namespace)
    if (!prior || prior.device_id === target.deviceId || prior.epoch !== input.expectedEpoch || !inactive(prior, now)) throw new Error('Matter transfer source is unavailable')
    const candidate = lease(prior)
    if (!await this.recovery.verify({ ...candidate, ...input, targetDeviceId: target.deviceId })) throw new Error('Matter recovery and owner approval were not verified')
    const commitNow = this.clock()
    if (commitNow.getTime() < now.getTime()) throw new Error('Matter transfer clock moved backwards')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const currentTarget = this.#session(sessionId, commitNow)
      const current = this.#row(currentTarget, namespace)
      if (!current || current.device_id !== prior.device_id || current.epoch !== input.expectedEpoch || !inactive(current, commitNow)) throw new Error('Matter transfer source changed while verifying recovery')
      if (Number(current.epoch) >= Number.MAX_SAFE_INTEGER) throw new Error('Matter owner epoch exhausted')
      const nextEpoch = Number(current.epoch) + 1; const at = commitNow.toISOString(); const expiresAt = new Date(commitNow.getTime() + ttlMs).toISOString()
      this.db.prepare(`UPDATE cp_matter_owner_lease SET device_id=?,epoch=?,lease_expires_at=?,released_at=NULL,updated_at=? WHERE tenant_id=? AND user_id=? AND namespace=?`)
        .run(currentTarget.deviceId, nextEpoch, expiresAt, at, currentTarget.tenantId, currentTarget.userId, namespace)
      this.db.prepare(`INSERT INTO cp_matter_owner_transfer (tenant_id,user_id,namespace,from_device_id,to_device_id,from_epoch,to_epoch,recovery_digest,approval_digest,transferred_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(currentTarget.tenantId, currentTarget.userId, namespace, String(current.device_id), currentTarget.deviceId, input.expectedEpoch, nextEpoch, input.recoveryDigest, input.approvalDigest, at)
      this.db.exec('COMMIT')
      return Object.freeze({ ...currentTarget, namespace, epoch: nextEpoch, expiresAt })
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  async close(): Promise<void> { this.db.close() }

  #session(sessionId: string, now: Date): { tenantId: string; userId: string; deviceId: string } {
    timestamp(now)
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new Error('device session is invalid')
    const row = this.db.prepare(`SELECT s.tenant_id,s.user_id,s.device_id FROM cp_device_session s
      JOIN cp_device d ON d.tenant_id=s.tenant_id AND d.device_id=s.device_id AND d.user_id=s.user_id
      JOIN cp_user u ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id
      WHERE s.session_id=? AND s.state='active' AND s.expires_at>? AND d.state='registered' AND u.state='active'`)
      .get(sessionId, now.toISOString()) as Row | undefined
    if (!row) throw new Error('active registered device session is unavailable')
    return { tenantId: String(row.tenant_id), userId: String(row.user_id), deviceId: String(row.device_id) }
  }
  #row(session: { tenantId: string; userId: string }, namespace: string): Row | undefined {
    return this.db.prepare(`SELECT * FROM cp_matter_owner_lease WHERE tenant_id=? AND user_id=? AND namespace=?`)
      .get(session.tenantId, session.userId, namespace) as Row | undefined
  }
}

export async function openSqliteInactiveMatterOwnerLeaseV1(databasePath: string, migrations: readonly string[], recovery: MatterOwnerRecoveryVerifierV1, clock: () => Date = () => new Date()): Promise<SqliteInactiveMatterOwnerLeaseV1> {
  if (!recovery || typeof recovery.verify !== 'function') throw new Error('Matter recovery verifier is required')
  const path = resolve(databasePath); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const db = new DatabaseSync(path)
  try { for (const migration of migrations) db.exec(await readFile(resolve(migration), 'utf8')); return new SqliteInactiveMatterOwnerLeaseV1(db, recovery, clock) }
  catch (error) { db.close(); throw error }
}

function lease(row: Row): MatterOwnerLeaseV1 {
  return { tenantId: String(row.tenant_id), userId: String(row.user_id), namespace: String(row.namespace), deviceId: String(row.device_id), epoch: Number(row.epoch), expiresAt: String(row.lease_expires_at) }
}
function inactive(row: Row, now: Date): boolean { return row.released_at !== null || Date.parse(String(row.lease_expires_at)) <= now.getTime() }
function scope(value: string): void { if (!namespacePattern.test(value)) throw new Error('Matter namespace is invalid') }
function epoch(value: number): void { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Matter owner epoch is invalid') }
function ttl(value: number): void { if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) throw new Error('Matter owner ttl is invalid') }
function timestamp(value: Date): string { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Matter owner time is invalid'); return value.toISOString() }
