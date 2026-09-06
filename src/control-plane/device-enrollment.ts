import { createHash, createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validateDeviceIdentity } from '../client-runtime/validation.js'
import type { DeviceEnrollmentRequestV1, DeviceEnrollmentServerPortV1, DeviceEnrollmentStatusV1, TenantContextV1, TenantDevicePortV1 } from './contracts.js'

type Row = Record<string, string | null>
const requestPattern = /^enrollment\.[a-f0-9]{32}$/
const userCodePattern = /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/
const pollTokenPattern = /^[A-Za-z0-9_-]{43}$/
const lifetimeMs = 10 * 60_000

export interface DeviceEnrollmentRandomSourceV1 { bytes(length: number): Uint8Array }
class NodeDeviceEnrollmentRandomSourceV1 implements DeviceEnrollmentRandomSourceV1 { bytes(length: number): Uint8Array { return randomBytes(length) } }

/** Durable OAuth-device-style registration that never gives a browser session credential to the client. */
export class SqliteInactiveDeviceEnrollmentV1 implements DeviceEnrollmentServerPortV1 {
  #approvalTail: Promise<void> = Promise.resolve()
  constructor(private readonly database: DatabaseSync, private readonly devices: TenantDevicePortV1, private readonly random: DeviceEnrollmentRandomSourceV1 = new NodeDeviceEnrollmentRandomSourceV1()) {}

  async begin(input: { readonly tenantId: string; readonly userId: string; readonly deviceId: string; readonly publicKey: string }, now = new Date()): Promise<DeviceEnrollmentRequestV1> {
    validateTime(now)
    validateDeviceIdentity({ schemaVersion: 1, ...input, keyAlgorithm: 'ed25519', createdAt: now.toISOString(), attestation: { kind: 'self', reference: 'self:enrollment-request' } })
    validateEd25519PublicKey(input.publicKey)
    this.#expire(now)
    const existing = this.database.prepare(`SELECT request_id FROM cp_device_enrollment WHERE tenant_hint=? AND user_hint=? AND device_id=? AND state IN ('pending','approving')`).get(input.tenantId, input.userId, input.deviceId)
    if (existing) throw new Error('device enrollment request already pending')
    const requestId = `enrollment.${hex(this.random.bytes(16))}`
    const userCode = formatUserCode(this.random.bytes(8))
    const pollToken = Buffer.from(this.random.bytes(32)).toString('base64url')
    if (!requestPattern.test(requestId) || !userCodePattern.test(userCode) || !pollTokenPattern.test(pollToken)) throw new Error('device enrollment entropy source is invalid')
    const expiresAt = new Date(now.getTime() + lifetimeMs).toISOString()
    try {
      this.database.prepare(`INSERT INTO cp_device_enrollment (request_id,user_code,poll_token_digest,tenant_hint,user_hint,device_id,public_key,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)`)
        .run(requestId, userCode, digest(pollToken), input.tenantId, input.userId, input.deviceId, input.publicKey, now.toISOString(), expiresAt)
    } catch (error) { throw new Error(String(error).includes('UNIQUE constraint failed') ? 'device enrollment identifier collision' : 'device enrollment request could not be persisted') }
    return freeze({ schemaVersion: 1, requestId, userCode, pollToken, verificationPath: '/devices/activate', expiresAt, pollAfterSeconds: 5 })
  }

  async approve(context: TenantContextV1, userCode: string, now = new Date()): Promise<DeviceEnrollmentStatusV1> {
    const prior = this.#approvalTail
    let release!: () => void
    this.#approvalTail = new Promise(resolve => { release = resolve })
    await prior
    try { return await this.#approveSerial(context, userCode, now) } finally { release() }
  }

  async poll(input: { readonly requestId: string; readonly pollToken: string }, now = new Date()): Promise<DeviceEnrollmentStatusV1> {
    validateTime(now)
    if (!requestPattern.test(input.requestId) || !pollTokenPattern.test(input.pollToken)) throw new Error('device enrollment poll credential is invalid')
    this.#expire(now)
    const row = this.#rowByRequest(input.requestId)
    if (!row || !safeDigestMatch(String(row.poll_token_digest), digest(input.pollToken))) throw new Error('device enrollment poll credential is invalid')
    return status(row)
  }

  async close(): Promise<void> { await this.#approvalTail; this.database.close() }

  async #approveSerial(context: TenantContextV1, userCode: string, now: Date): Promise<DeviceEnrollmentStatusV1> {
    validateTime(now)
    if (!userCodePattern.test(userCode)) throw new Error('device enrollment user code is invalid')
    this.#expire(now)
    let row = this.database.prepare('SELECT * FROM cp_device_enrollment WHERE user_code=?').get(userCode) as Row | undefined
    if (!row) throw new Error('device enrollment request is unavailable')
    if (row.tenant_hint !== context.tenantId || row.user_hint !== context.userId) throw new Error('device enrollment request is not authorized for authenticated user')
    if (row.state === 'approved') return status(row)
    if (row.state === 'expired') throw new Error('device enrollment request expired')
    if (row.state === 'approving' && Date.parse(String(row.decision_started_at)) + 30_000 > now.getTime()) throw new Error('device enrollment approval is already in progress')
    const requestId = String(row.request_id)
    const changed = this.database.prepare(`UPDATE cp_device_enrollment SET state='approving', decision_started_at=? WHERE request_id=? AND state IN ('pending','approving')`).run(now.toISOString(), requestId).changes
    if (changed !== 1) throw new Error('device enrollment approval conflict')
    try {
      await this.devices.registerDevice(context, { deviceId: String(row.device_id), publicKey: String(row.public_key) }, now)
      const completed = this.database.prepare(`UPDATE cp_device_enrollment SET state='approved', approved_at=? WHERE request_id=? AND state='approving'`).run(now.toISOString(), requestId).changes
      if (completed !== 1) throw new Error('device enrollment approval conflict')
    } catch (error) {
      this.database.prepare(`UPDATE cp_device_enrollment SET state='pending', decision_started_at=NULL WHERE request_id=? AND state='approving'`).run(requestId)
      throw error
    }
    row = this.#rowByRequest(requestId)
    if (!row) throw new Error('device enrollment approval was not persisted')
    return status(row)
  }

  #expire(now: Date): void { this.database.prepare(`UPDATE cp_device_enrollment SET state='expired' WHERE state='pending' AND expires_at<=?`).run(now.toISOString()) }
  #rowByRequest(requestId: string): Row | undefined { return this.database.prepare('SELECT * FROM cp_device_enrollment WHERE request_id=?').get(requestId) as Row | undefined }
}

export async function openSqliteInactiveDeviceEnrollment(databasePath: string, migrationPath: string, devices: TenantDevicePortV1, random?: DeviceEnrollmentRandomSourceV1): Promise<SqliteInactiveDeviceEnrollmentV1> {
  const path = resolve(databasePath); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const database = new DatabaseSync(path)
  try { database.exec(await readFile(resolve(migrationPath), 'utf8')); return new SqliteInactiveDeviceEnrollmentV1(database, devices, random) }
  catch (error) { database.close(); throw error }
}

function status(row: Row): DeviceEnrollmentStatusV1 { return freeze({ schemaVersion: 1, requestId: String(row.request_id), deviceId: String(row.device_id), state: row.state === 'approved' ? 'approved' : row.state === 'expired' ? 'expired' : 'pending', expiresAt: String(row.expires_at) }) }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function safeDigestMatch(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.byteLength === b.byteLength && timingSafeEqual(a, b) }
function hex(bytes: Uint8Array): string { return Buffer.from(bytes).toString('hex') }
function formatUserCode(bytes: Uint8Array): string { const value = hex(bytes).toUpperCase(); return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}` }
function validateEd25519PublicKey(value: string): void {
  const prefix = 'ed25519-spki:'
  if (!value.startsWith(prefix)) throw new Error('device enrollment public key is invalid')
  try {
    const encoded = value.slice(prefix.length); const der = Buffer.from(encoded, 'base64url')
    if (!encoded || der.toString('base64url') !== encoded) throw new Error('invalid encoding')
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('invalid algorithm')
  } catch { throw new Error('device enrollment public key is invalid') }
}
function validateTime(now: Date): void { if (Number.isNaN(now.getTime())) throw new Error('device enrollment timestamp is invalid') }
function freeze<T>(value: T): T { return Object.freeze(value) }
