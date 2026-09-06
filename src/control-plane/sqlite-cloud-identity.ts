import { randomBytes, scrypt as nodeScrypt, timingSafeEqual, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CloudAuthenticationPortV1, TenantContextV1 } from './contracts.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const sessionPattern = /^session:[a-f0-9]{64}$/
const allowedRoles = new Set(['owner', 'member', 'auditor'])

/** Persistent identity adapter. Raw passwords and session references are never stored. */
export class SqliteCloudIdentityProviderV1 implements CloudAuthenticationPortV1 {
  constructor(private readonly database: DatabaseSync) {}

  async provisionAccount(input: { readonly tenantId: string; readonly userId: string; readonly password: string; readonly roles: readonly ('owner' | 'member' | 'auditor')[] }, now = new Date()): Promise<void> {
    validateIdentity(input.tenantId, input.userId); const roles = validateRoles(input.roles); const password = passwordBytes(input.password); const salt = randomBytes(32)
    try {
      const hash = await derive(password, salt)
      try { this.database.prepare('INSERT INTO cp_auth_account (tenant_id, user_id, password_salt, password_hash, roles_json, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(input.tenantId, input.userId, salt, hash, JSON.stringify(roles), 'active', validNow(now)) }
      finally { hash.fill(0) }
    } catch (error) { if (String(error).includes('UNIQUE constraint failed')) throw new Error('cloud identity account already exists'); throw error }
    finally { password.fill(0); salt.fill(0) }
  }

  async authenticate(input: { readonly tenantId: string; readonly userId: string; readonly password: string }, now = new Date()): Promise<{ readonly sessionReference: string; readonly expiresAt: string }> {
    validateIdentity(input.tenantId, input.userId); const timestamp = validNow(now); const password = passwordBytes(input.password)
    const row = this.database.prepare(`SELECT a.password_salt, a.password_hash, a.state AS account_state, u.state AS user_state, t.state AS tenant_state
      FROM cp_auth_account a JOIN cp_user u ON u.tenant_id=a.tenant_id AND u.user_id=a.user_id JOIN cp_tenant t ON t.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND a.user_id=?`).get(input.tenantId, input.userId) as { password_salt: Uint8Array; password_hash: Uint8Array; account_state: string; user_state: string; tenant_state: string } | undefined
    const throttle = this.database.prepare('SELECT window_started_at, failure_count, blocked_until FROM cp_auth_throttle WHERE tenant_id=? AND user_id=?').get(input.tenantId, input.userId) as { window_started_at: string; failure_count: number; blocked_until: string | null } | undefined
    const blocked = Boolean(throttle?.blocked_until && Date.parse(throttle.blocked_until) > Date.parse(timestamp))
    const salt = row ? Buffer.from(row.password_salt) : Buffer.alloc(32); const expected = row ? Buffer.from(row.password_hash) : Buffer.alloc(32); let actual: Buffer | undefined
    try {
      actual = await derive(password, salt)
      if (blocked || !row || row.account_state !== 'active' || row.user_state !== 'active' || !['active', 'test'].includes(row.tenant_state) || expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) { if (!blocked) this.#recordFailure(input.tenantId, input.userId, timestamp, throttle); throw new Error('cloud authentication failed') }
      this.database.prepare('DELETE FROM cp_auth_throttle WHERE tenant_id=? AND user_id=?').run(input.tenantId, input.userId)
      const token = randomBytes(32); const sessionReference = `session:${token.toString('hex')}`; token.fill(0)
      const expiresAt = new Date(new Date(timestamp).getTime() + 8 * 60 * 60_000).toISOString()
      this.database.prepare('INSERT INTO cp_browser_session (session_digest, tenant_id, user_id, issued_at, expires_at, state) VALUES (?, ?, ?, ?, ?, ?)').run(sessionDigest(sessionReference), input.tenantId, input.userId, timestamp, expiresAt, 'active')
      return Object.freeze({ sessionReference, expiresAt })
    } finally { password.fill(0); salt.fill(0); expected.fill(0); actual?.fill(0) }
  }

  async resolveSession(sessionReference: string, now = new Date()): Promise<TenantContextV1 | undefined> {
    if (!sessionPattern.test(sessionReference)) return undefined
    const timestamp = validNow(now)
    const row = this.database.prepare(`SELECT s.tenant_id, s.user_id, s.expires_at, s.state, a.roles_json, a.state AS account_state, u.state AS user_state, t.state AS tenant_state
      FROM cp_browser_session s JOIN cp_auth_account a ON a.tenant_id=s.tenant_id AND a.user_id=s.user_id JOIN cp_user u ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id JOIN cp_tenant t ON t.tenant_id=s.tenant_id
      WHERE s.session_digest=?`).get(sessionDigest(sessionReference)) as Record<string, string> | undefined
    if (!row || row.state !== 'active' || row.account_state !== 'active' || row.user_state !== 'active' || !['active', 'test'].includes(row.tenant_state!)) return undefined
    if (Date.parse(row.expires_at!) <= Date.parse(timestamp)) { this.database.prepare("UPDATE cp_browser_session SET state='expired' WHERE session_digest=? AND state='active'").run(sessionDigest(sessionReference)); return undefined }
    let roles: unknown
    try { roles = JSON.parse(row.roles_json!) } catch { return undefined }
    return Object.freeze({ tenantId: row.tenant_id!, userId: row.user_id!, roles: validateRoles(roles) })
  }

  async revoke(sessionReference: string, now = new Date()): Promise<void> { validNow(now); if (!sessionPattern.test(sessionReference)) throw new Error('cloud session reference is invalid'); this.database.prepare("UPDATE cp_browser_session SET state='revoked' WHERE session_digest=? AND state='active'").run(sessionDigest(sessionReference)) }
  async close(): Promise<void> { this.database.close() }

  #recordFailure(tenantId: string, userId: string, timestamp: string, existing: { window_started_at: string; failure_count: number; blocked_until: string | null } | undefined): void {
    const now = Date.parse(timestamp); const withinWindow = existing && now - Date.parse(existing.window_started_at) < 15 * 60_000
    const count = withinWindow ? existing.failure_count + 1 : 1; const windowStart = withinWindow ? existing.window_started_at : timestamp
    const blockedUntil = count >= 5 ? new Date(now + 15 * 60_000).toISOString() : null
    this.database.prepare(`INSERT INTO cp_auth_throttle (tenant_id, user_id, window_started_at, failure_count, blocked_until) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET window_started_at=excluded.window_started_at, failure_count=excluded.failure_count, blocked_until=excluded.blocked_until`).run(tenantId, userId, windowStart, count, blockedUntil)
  }
}

export async function openSqliteCloudIdentityProvider(databasePath: string, migrations: readonly string[]): Promise<SqliteCloudIdentityProviderV1> { const path = resolve(databasePath); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const database = new DatabaseSync(path); try { for (const migration of migrations) database.exec(await readFile(resolve(migration), 'utf8')); return new SqliteCloudIdentityProviderV1(database) } catch (error) { database.close(); throw error } }
function validateIdentity(tenantId: string, userId: string): void { if (!idPattern.test(tenantId) || !idPattern.test(userId)) throw new Error('cloud identity scope is invalid') }
function validateRoles(value: unknown): readonly ('owner' | 'member' | 'auditor')[] { if (!Array.isArray(value) || !value.length || value.some(role => typeof role !== 'string' || !allowedRoles.has(role)) || new Set(value).size !== value.length) throw new Error('cloud identity roles are invalid'); return Object.freeze([...value] as ('owner' | 'member' | 'auditor')[]) }
function passwordBytes(value: string): Buffer { const bytes = Buffer.from(value, 'utf8'); if (bytes.byteLength < 12 || bytes.byteLength > 256 || /\0/.test(value)) { bytes.fill(0); throw new Error('cloud authentication failed') }; return bytes }
async function derive(password: Uint8Array, salt: Uint8Array): Promise<Buffer> { return await new Promise((accept, reject) => nodeScrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => error ? reject(error) : accept(Buffer.from(value)))) }
function sessionDigest(value: string): string { return createHash('sha256').update('quark-cloud-session-v1\0').update(value).digest('hex') }
function validNow(value: Date): string { if (Number.isNaN(value.getTime())) throw new Error('cloud identity timestamp is invalid'); return value.toISOString() }
