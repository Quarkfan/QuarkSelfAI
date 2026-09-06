import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DeviceRecordV1, TenantRecordV1, UserRecordV1 } from './contracts.js'
import type { TenantControlRepositoryV1 } from './tenant-persistence.js'

type Row = Record<string, string>

export class SqliteTenantControlRepositoryV1 implements TenantControlRepositoryV1 {
  constructor(private readonly database: DatabaseSync) {}

  async createTenant(input: TenantRecordV1): Promise<TenantRecordV1> {
    try {
      this.database.prepare('INSERT INTO cp_tenant (tenant_id, name, state, created_at) VALUES (?, ?, ?, ?)').run(input.tenantId, input.name, input.state, input.createdAt)
    } catch (error) {
      if (!String(error).includes('UNIQUE constraint failed')) throw error
      const existing = await this.getTenant(input.tenantId)
      if (!existing || JSON.stringify(existing) !== JSON.stringify(input)) throw new Error('tenant already exists with different immutable content')
      return existing
    }
    return Object.freeze({ ...input })
  }

  async getTenant(tenantId: string): Promise<TenantRecordV1 | undefined> {
    const row = this.database.prepare('SELECT tenant_id, name, state, created_at FROM cp_tenant WHERE tenant_id = ?').get(tenantId) as Row | undefined
    return row ? tenant(row) : undefined
  }

  async putUser(input: UserRecordV1): Promise<UserRecordV1> {
    this.database.prepare(`INSERT INTO cp_user (tenant_id, user_id, display_name, state, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET display_name = excluded.display_name, state = excluded.state`).run(input.tenantId, input.userId, input.displayName, input.state, input.createdAt)
    return Object.freeze({ ...input })
  }

  async getUser(tenantId: string, userId: string): Promise<UserRecordV1 | undefined> {
    const row = this.database.prepare('SELECT tenant_id, user_id, display_name, state, created_at FROM cp_user WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId) as Row | undefined
    return row ? user(row) : undefined
  }

  async putDevice(input: DeviceRecordV1): Promise<DeviceRecordV1> {
    const existing = await this.getDevice(input.tenantId, input.deviceId)
    if (existing && (existing.userId !== input.userId || existing.publicKey !== input.publicKey)) throw new Error('device identity is immutable inside a tenant')
    this.database.prepare(`INSERT INTO cp_device (tenant_id, device_id, user_id, public_key, state, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, device_id) DO UPDATE SET state = excluded.state`).run(input.tenantId, input.deviceId, input.userId, input.publicKey, input.state, input.createdAt)
    return existing ?? Object.freeze({ ...input })
  }

  async getDevice(tenantId: string, deviceId: string): Promise<DeviceRecordV1 | undefined> {
    const row = this.database.prepare('SELECT tenant_id, device_id, user_id, public_key, state, created_at FROM cp_device WHERE tenant_id = ? AND device_id = ?').get(tenantId, deviceId) as Row | undefined
    return row ? device(row) : undefined
  }

  async listDevices(tenantId: string, userId?: string): Promise<readonly DeviceRecordV1[]> {
    const rows = (userId
      ? this.database.prepare('SELECT tenant_id, device_id, user_id, public_key, state, created_at FROM cp_device WHERE tenant_id = ? AND user_id = ? ORDER BY device_id').all(tenantId, userId)
      : this.database.prepare('SELECT tenant_id, device_id, user_id, public_key, state, created_at FROM cp_device WHERE tenant_id = ? ORDER BY device_id').all(tenantId)) as unknown as Row[]
    return Object.freeze(rows.map(device))
  }

  async close(): Promise<void> { this.database.close() }
}

export async function openSqliteTenantControlRepository(databasePath: string, migrationPath: string): Promise<SqliteTenantControlRepositoryV1> {
  const path = resolve(databasePath)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(path)
  try {
    database.exec(await readFile(resolve(migrationPath), 'utf8'))
    return new SqliteTenantControlRepositoryV1(database)
  } catch (error) {
    database.close()
    throw error
  }
}

function tenant(row: Row): TenantRecordV1 { return Object.freeze({ tenantId: row.tenant_id!, name: row.name!, state: row.state as TenantRecordV1['state'], createdAt: row.created_at! }) }
function user(row: Row): UserRecordV1 { return Object.freeze({ tenantId: row.tenant_id!, userId: row.user_id!, displayName: row.display_name!, state: row.state as UserRecordV1['state'], createdAt: row.created_at! }) }
function device(row: Row): DeviceRecordV1 { return Object.freeze({ tenantId: row.tenant_id!, userId: row.user_id!, deviceId: row.device_id!, publicKey: row.public_key!, state: row.state as DeviceRecordV1['state'], createdAt: row.created_at! }) }
