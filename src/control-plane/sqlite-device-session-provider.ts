import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DeviceProofVerifierV1, DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseAcknowledgementV1, DeviceTaskLeaseV1, PlanSignatureVerifierV1, SignedExecutionPlanV1 } from '../client-runtime/contracts.js'
import { verifySignedExecutionPlan } from '../client-runtime/validation.js'
import type { DeviceDispatchQueuePortV1, DeviceSessionServerPortV1, DispatchRecordV1, RedactedResultV1, TenantContextV1 } from './contracts.js'

type Row = Record<string, string | number | null>
type TokenSource = { next(label: 'challenge' | 'nonce' | 'session' | 'lease'): string }
const tokenPattern = /^[a-z0-9][a-z0-9._:-]{0,255}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const unsafeText = /^(?:\/|[A-Za-z]:[\\/]|~[\\/])|(?:token|secret|password|private[_-]?key)\s*[:=]/i

/** Persistent no-effect device protocol provider. It owns no listener, executor, scheduler or external effect. */
export class SqliteInactiveDeviceSessionProviderV1 implements DeviceSessionServerPortV1, DeviceDispatchQueuePortV1 {
  constructor(private readonly db: DatabaseSync, private readonly tokens: TokenSource, private readonly proofVerifier: DeviceProofVerifierV1, private readonly planVerifier: PlanSignatureVerifierV1) {}

  async issueChallenge(context: TenantContextV1, deviceId: string, now = new Date(), ttlMs = 60_000): Promise<DeviceSessionChallengeV1> {
    testContext(context); positive(ttlMs, 'challenge ttl')
    const device = this.db.prepare(`SELECT d.user_id, d.state, u.state AS user_state FROM cp_device d JOIN cp_user u ON u.tenant_id=d.tenant_id AND u.user_id=d.user_id WHERE d.tenant_id = ? AND d.device_id = ?`).get(context.tenantId, deviceId) as Row | undefined
    if (!device || device.user_id !== context.userId || device.state !== 'registered' || device.user_state !== 'active') throw new Error('registered device is unavailable')
    const challenge = Object.freeze({ schemaVersion: 1 as const, challengeId: this.#token('challenge'), tenantId: context.tenantId, userId: context.userId,
      deviceId, nonce: this.#token('nonce'), issuedAt: timestamp(now), expiresAt: new Date(now.getTime() + ttlMs).toISOString() })
    this.db.prepare(`INSERT INTO cp_device_challenge (challenge_id, tenant_id, user_id, device_id, nonce, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(challenge.challengeId, challenge.tenantId, challenge.userId, challenge.deviceId, challenge.nonce, challenge.issuedAt, challenge.expiresAt)
    return challenge
  }

  async openSession(proof: DeviceSessionProofV1, now = new Date(), ttlMs = 300_000): Promise<DeviceSessionV1> {
    positive(ttlMs, 'session ttl')
    if (proof.schemaVersion !== 1 || proof.algorithm !== 'ed25519' || !proof.keyId || !proof.signature) throw new Error('device proof is invalid')
    const row = this.db.prepare(`SELECT c.*, d.public_key, d.state AS device_state, u.state AS user_state FROM cp_device_challenge c JOIN cp_device d ON d.tenant_id = c.tenant_id AND d.device_id = c.device_id JOIN cp_user u ON u.tenant_id=c.tenant_id AND u.user_id=c.user_id WHERE c.challenge_id = ?`).get(proof.challengeId) as Row | undefined
    if (!row || row.device_id !== proof.deviceId || row.consumed_at || row.device_state !== 'registered' || row.user_state !== 'active') throw new Error('device challenge is unavailable or out of scope')
    if (Date.parse(String(row.expires_at)) <= now.getTime()) throw new Error('device challenge expired')
    if (!await this.proofVerifier.verify({ publicKey: String(row.public_key), algorithm: proof.algorithm, challenge: String(row.nonce), signature: proof.signature })) throw new Error('device proof verification failed')
    const session = Object.freeze({ schemaVersion: 1 as const, sessionId: this.#token('session'), tenantId: String(row.tenant_id), userId: String(row.user_id), deviceId: proof.deviceId,
      issuedAt: timestamp(now), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), state: 'active' as const })
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const consumed = this.db.prepare(`UPDATE cp_device_challenge SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL`).run(session.issuedAt, proof.challengeId)
      if (Number(consumed.changes) !== 1) throw new Error('device challenge was already consumed')
      this.db.prepare(`UPDATE cp_device_session SET state = 'superseded' WHERE tenant_id = ? AND device_id = ? AND state = 'active'`).run(session.tenantId, session.deviceId)
      this.db.prepare(`INSERT INTO cp_device_session (session_id, tenant_id, user_id, device_id, issued_at, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, 'active')`)
        .run(session.sessionId, session.tenantId, session.userId, session.deviceId, session.issuedAt, session.expiresAt)
      this.db.exec('COMMIT'); return session
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  async enqueue(dispatch: DispatchRecordV1, now = new Date()): Promise<DispatchRecordV1> {
    if (!dispatch.tenantId.startsWith('test.') || dispatch.state !== 'queued' || dispatch.plan.envelope.allowedEffects.length || dispatch.plan.envelope.approvalGrants.length) throw new Error('inactive device queue accepts no-effect test dispatches only')
    if (dispatch.plan.envelope.tenantId !== dispatch.tenantId || dispatch.plan.envelope.userId !== dispatch.userId || dispatch.plan.envelope.deviceId !== dispatch.deviceId) throw new Error('dispatch plan scope mismatch')
    await verifySignedExecutionPlan(dispatch.plan, this.planVerifier, now)
    const device = this.db.prepare(`SELECT user_id, state FROM cp_device WHERE tenant_id = ? AND device_id = ?`).get(dispatch.tenantId, dispatch.deviceId) as Row | undefined
    if (!device || device.user_id !== dispatch.userId || device.state !== 'registered') throw new Error('dispatch device is unavailable')
    const existing = this.#dispatch(dispatch.tenantId, dispatch.taskId)
    if (existing) {
      if (existing.idempotencyKey !== dispatch.idempotencyKey || JSON.stringify(existing.plan) !== JSON.stringify(dispatch.plan)) throw new Error('immutable dispatch already exists with different content')
      return existing
    }
    try {
      this.db.prepare(`INSERT INTO cp_device_dispatch (tenant_id, task_id, user_id, device_id, plan_id, plan_json, idempotency_key, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`)
        .run(dispatch.tenantId, dispatch.taskId, dispatch.userId, dispatch.deviceId, dispatch.plan.planId, JSON.stringify(dispatch.plan), dispatch.idempotencyKey, dispatch.createdAt)
    } catch (error) { if (String(error).includes('idempotency_key')) throw new Error('idempotency key is already assigned to another task'); throw error }
    return Object.freeze({ ...dispatch })
  }

  async poll(sessionId: string, now = new Date(), ttlMs = 60_000): Promise<DeviceTaskLeaseV1 | null> {
    positive(ttlMs, 'lease ttl'); const session = this.#activeSession(sessionId, now)
    const row = this.db.prepare(`SELECT * FROM cp_device_dispatch WHERE tenant_id = ? AND user_id = ? AND device_id = ? AND acknowledged_at IS NULL AND state IN ('queued','leased') ORDER BY created_at, task_id LIMIT 1`).get(session.tenantId, session.userId, session.deviceId) as Row | undefined
    if (!row) return null
    const plan = JSON.parse(String(row.plan_json)) as SignedExecutionPlanV1
    await verifySignedExecutionPlan(plan, this.planVerifier, now)
    if (row.lease_token && Date.parse(String(row.lease_expires_at)) > now.getTime()) return lease(row, plan)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.#taskRow(session, String(row.task_id))
      if (!current || current.acknowledged_at || !['queued', 'leased'].includes(String(current.state))) { this.db.exec('COMMIT'); return null }
      if (current.lease_token && Date.parse(String(current.lease_expires_at)) > now.getTime()) { const existing = lease(current, plan); this.db.exec('COMMIT'); return existing }
      const leaseToken = this.#token('lease'); const attempt = Number(current.lease_attempt) + 1; const leasedAt = timestamp(now); const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
      this.db.prepare(`UPDATE cp_device_dispatch SET state='leased', lease_token=?, lease_attempt=?, leased_at=?, lease_expires_at=? WHERE tenant_id=? AND task_id=?`)
        .run(leaseToken, attempt, leasedAt, expiresAt, session.tenantId, String(current.task_id))
      this.db.exec('COMMIT')
      return Object.freeze({ schemaVersion: 1, taskId: String(current.task_id), planId: String(current.plan_id), plan, deviceId: session.deviceId, leaseToken, attempt, leasedAt, expiresAt, externalWritesEnabled: false })
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  async acknowledge(sessionId: string, input: { leaseToken: string; taskId: string }, now = new Date()): Promise<DeviceTaskLeaseAcknowledgementV1> {
    const session = this.#activeSession(sessionId, now); const row = this.#taskRow(session, input.taskId)
    if (!row || row.lease_token !== input.leaseToken || !row.lease_expires_at || Date.parse(String(row.lease_expires_at)) <= now.getTime()) throw new Error('task lease is unavailable, expired or out of scope')
    const acceptedAt = row.acknowledged_at ? String(row.acknowledged_at) : timestamp(now)
    this.db.prepare(`UPDATE cp_device_dispatch SET acknowledged_at=? WHERE tenant_id=? AND task_id=? AND acknowledged_at IS NULL`).run(acceptedAt, session.tenantId, input.taskId)
    return Object.freeze({ schemaVersion: 1, taskId: input.taskId, planId: String(row.plan_id), deviceId: session.deviceId, state: 'accepted', acceptedAt })
  }

  async submitResult(sessionId: string, input: Omit<RedactedResultV1, 'tenantId' | 'userId'>, now = new Date()): Promise<RedactedResultV1> {
    const session = this.#activeSession(sessionId, now); const row = this.#taskRow(session, input.taskId)
    if (!row || !row.acknowledged_at || row.plan_id !== input.planId || input.deviceId !== session.deviceId) throw new Error('result is outside the acknowledged lease scope')
    validateResult(input)
    const result = Object.freeze({ ...input, tenantId: session.tenantId, userId: session.userId })
    const existing = this.db.prepare(`SELECT result_json FROM cp_device_result WHERE tenant_id=? AND task_id=?`).get(session.tenantId, input.taskId) as Row | undefined
    if (existing) { const value = JSON.parse(String(existing.result_json)) as RedactedResultV1; if (JSON.stringify(value) !== JSON.stringify(result)) throw new Error('immutable result already exists with different evidence'); return Object.freeze(value) }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`INSERT INTO cp_device_result (tenant_id, task_id, result_json, completed_at) VALUES (?, ?, ?, ?)`).run(session.tenantId, input.taskId, JSON.stringify(result), input.completedAt)
      this.db.prepare(`UPDATE cp_device_dispatch SET state=? WHERE tenant_id=? AND task_id=?`).run(input.outcome === 'succeeded' ? 'completed' : input.outcome, session.tenantId, input.taskId)
      this.db.exec('COMMIT'); return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  async close(): Promise<void> { this.db.close() }

  #activeSession(sessionId: string, now: Date): DeviceSessionV1 {
    const row = this.db.prepare(`SELECT * FROM cp_device_session WHERE session_id=?`).get(sessionId) as Row | undefined
    if (!row || row.state !== 'active') throw new Error('device session is not active')
    if (Date.parse(String(row.expires_at)) <= now.getTime()) { this.db.prepare(`UPDATE cp_device_session SET state='expired' WHERE session_id=?`).run(sessionId); throw new Error('device session expired') }
    return sessionFrom(row)
  }
  #taskRow(session: DeviceSessionV1, taskId: string): Row | undefined { return this.db.prepare(`SELECT * FROM cp_device_dispatch WHERE tenant_id=? AND task_id=? AND user_id=? AND device_id=?`).get(session.tenantId, taskId, session.userId, session.deviceId) as Row | undefined }
  #dispatch(tenantId: string, taskId: string): DispatchRecordV1 | undefined { const row = this.db.prepare(`SELECT * FROM cp_device_dispatch WHERE tenant_id=? AND task_id=?`).get(tenantId, taskId) as Row | undefined; return row ? dispatchFrom(row) : undefined }
  #token(label: 'challenge' | 'nonce' | 'session' | 'lease'): string { const value = this.tokens.next(label); if (!tokenPattern.test(value)) throw new Error(`${label} token is invalid`); return value }
}

export async function openSqliteInactiveDeviceSessionProvider(databasePath: string, migrations: readonly string[], tokens: TokenSource, proofVerifier: DeviceProofVerifierV1, planVerifier: PlanSignatureVerifierV1) {
  const path = resolve(databasePath); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const db = new DatabaseSync(path)
  try { for (const migration of migrations) db.exec(await readFile(resolve(migration), 'utf8')); return new SqliteInactiveDeviceSessionProviderV1(db, tokens, proofVerifier, planVerifier) } catch (error) { db.close(); throw error }
}

function sessionFrom(row: Row): DeviceSessionV1 { return Object.freeze({ schemaVersion: 1, sessionId: String(row.session_id), tenantId: String(row.tenant_id), userId: String(row.user_id), deviceId: String(row.device_id), issuedAt: String(row.issued_at), expiresAt: String(row.expires_at), state: String(row.state) as DeviceSessionV1['state'] }) }
function dispatchFrom(row: Row): DispatchRecordV1 { return Object.freeze({ tenantId: String(row.tenant_id), userId: String(row.user_id), taskId: String(row.task_id), deviceId: String(row.device_id), plan: JSON.parse(String(row.plan_json)), idempotencyKey: String(row.idempotency_key), state: String(row.state) as DispatchRecordV1['state'], createdAt: String(row.created_at) }) }
function lease(row: Row, plan: SignedExecutionPlanV1): DeviceTaskLeaseV1 { return Object.freeze({ schemaVersion: 1, taskId: String(row.task_id), planId: String(row.plan_id), plan, deviceId: String(row.device_id), leaseToken: String(row.lease_token), attempt: Number(row.lease_attempt), leasedAt: String(row.leased_at), expiresAt: String(row.lease_expires_at), externalWritesEnabled: false }) }
function testContext(context: TenantContextV1): void {
  if (!context.tenantId.startsWith('test.') || !tokenPattern.test(context.tenantId) || !tokenPattern.test(context.userId) || !context.roles.length || new Set(context.roles).size !== context.roles.length) throw new Error('inactive device provider accepts valid test tenants only')
}
function positive(value: number, label: string): void { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`) }
function timestamp(value: Date): string { if (Number.isNaN(value.getTime())) throw new Error('timestamp is invalid'); return value.toISOString() }
function validateResult(input: Omit<RedactedResultV1, 'tenantId' | 'userId'>): void {
  if (!tokenPattern.test(input.deviceId) || !tokenPattern.test(input.taskId) || !tokenPattern.test(input.planId) || !['succeeded','failed','cancelled'].includes(input.outcome) || !tokenPattern.test(input.summaryCode) || unsafeText.test(input.summaryCode) || input.artifactDigests.length > 64 || new Set(input.artifactDigests).size !== input.artifactDigests.length || !input.artifactDigests.every(value => digestPattern.test(value)) || Number.isNaN(Date.parse(input.completedAt))) throw new Error('result is not privacy bounded')
}
