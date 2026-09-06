import { DatabaseSync } from 'node:sqlite'
import { chmod, lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { SqliteCloudIdentityProviderV1 } from './sqlite-cloud-identity.js'
import { SqliteTenantControlRepositoryV1 } from './sqlite-tenant-repository.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const unsafeText = /(?:^|[\\/])Users[\\/]|(?:token|secret|password|private[_-]?key)\s*[:=]/i

export interface FirstCloudOwnerBootstrapV1 {
  readonly schemaVersion: 1
  readonly databasePath: string
  readonly tenantMigrationPath: string
  readonly identityMigrationPath: string
  readonly tenantId: string
  readonly tenantName: string
  readonly userId: string
  readonly displayName: string
}

export interface FirstCloudOwnerBootstrapReceiptV1 {
  readonly schemaVersion: 1; readonly tenantId: string; readonly userId: string
  readonly state: 'created'; readonly roles: readonly ['owner']; readonly createdAt: string
  readonly passwordRetained: false; readonly sessionCreated: false
}

/** Creates the first owner atomically. It refuses every non-empty identity database and never creates a session. */
export async function bootstrapFirstCloudOwnerV1(value: unknown, password: string, now = new Date()): Promise<FirstCloudOwnerBootstrapReceiptV1> {
  const input = await validate(value, password, now)
  const database = new DatabaseSync(input.databasePath)
  let transaction = false
  try {
    database.exec(await readFile(input.tenantMigrationPath, 'utf8'))
    database.exec(await readFile(input.identityMigrationPath, 'utf8'))
    await chmod(input.databasePath, 0o600)
    database.exec('BEGIN IMMEDIATE'); transaction = true
    const counts = database.prepare('SELECT (SELECT COUNT(*) FROM cp_tenant) AS tenants, (SELECT COUNT(*) FROM cp_user) AS users, (SELECT COUNT(*) FROM cp_auth_account) AS accounts').get() as { tenants: number; users: number; accounts: number }
    if (counts.tenants !== 0 || counts.users !== 0 || counts.accounts !== 0) throw new Error('cloud owner bootstrap requires an empty identity database')
    const createdAt = now.toISOString(); const repository = new SqliteTenantControlRepositoryV1(database); const identity = new SqliteCloudIdentityProviderV1(database)
    await repository.createTenant({ tenantId: input.tenantId, name: input.tenantName, state: 'active', createdAt })
    await repository.putUser({ tenantId: input.tenantId, userId: input.userId, displayName: input.displayName, state: 'active', createdAt })
    await identity.provisionAccount({ tenantId: input.tenantId, userId: input.userId, password, roles: ['owner'] }, now)
    database.exec('COMMIT'); transaction = false
    return Object.freeze({ schemaVersion: 1, tenantId: input.tenantId, userId: input.userId, state: 'created', roles: Object.freeze(['owner'] as const), createdAt, passwordRetained: false, sessionCreated: false })
  } catch (error) {
    if (transaction) { try { database.exec('ROLLBACK') } catch {} }
    throw error
  } finally { database.close() }
}

async function validate(value: unknown, password: string, now: Date): Promise<FirstCloudOwnerBootstrapV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('cloud owner bootstrap input is invalid')
  const input = value as Record<string, unknown>; const keys = ['schemaVersion', 'databasePath', 'tenantMigrationPath', 'identityMigrationPath', 'tenantId', 'tenantName', 'userId', 'displayName']
  if (Object.keys(input).sort().join(',') !== keys.sort().join(',') || typeof input.databasePath !== 'string' || typeof input.tenantMigrationPath !== 'string' || typeof input.identityMigrationPath !== 'string' || typeof input.tenantId !== 'string' || typeof input.tenantName !== 'string' || typeof input.userId !== 'string' || typeof input.displayName !== 'string') throw new Error('cloud owner bootstrap input is invalid')
  if (input.schemaVersion !== 1 || !idPattern.test(input.tenantId) || !idPattern.test(input.userId) || !safeText(input.tenantName) || !safeText(input.displayName) || Number.isNaN(now.getTime())) throw new Error('cloud owner bootstrap input is invalid')
  const bytes = Buffer.from(password, 'utf8'); const validPassword = bytes.byteLength >= 12 && bytes.byteLength <= 256 && !/[\0\r\n]/.test(password); bytes.fill(0)
  if (!validPassword) throw new Error('cloud owner bootstrap credential is invalid')
  for (const path of [input.databasePath, input.tenantMigrationPath, input.identityMigrationPath]) if (!isAbsolute(path) || resolve(path) !== path || /[\r\n\0]/.test(path)) throw new Error('cloud owner bootstrap paths are invalid')
  const root = dirname(input.databasePath); const state = await lstat(root)
  const uid = process.getuid?.()
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(root) !== root || (uid !== undefined && state.uid !== uid)) throw new Error('cloud owner bootstrap root must be private, owned and canonical')
  for (const path of [input.tenantMigrationPath, input.identityMigrationPath]) { const item = await lstat(path); if (!item.isFile() || item.isSymbolicLink()) throw new Error('cloud owner bootstrap migration must be a regular file') }
  try { const item = await lstat(input.databasePath); if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1 || await realpath(input.databasePath) !== input.databasePath || (uid !== undefined && item.uid !== uid)) throw new Error('cloud owner bootstrap database is unsafe') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return input as unknown as FirstCloudOwnerBootstrapV1
}

function safeText(value: string): boolean { return Boolean(value.trim()) && value.length <= 200 && !unsafeText.test(value) }
