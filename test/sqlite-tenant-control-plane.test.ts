import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

const migration = new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname
const at = new Date('2026-09-06T00:00:00.000Z')
const alpha: TenantContextV1 = { tenantId: 'alpha', userId: 'owner', roles: ['owner'] }
const beta: TenantContextV1 = { tenantId: 'beta', userId: 'owner', roles: ['owner'] }

test('persists same user and device ids in isolated tenant partitions across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-cp-'))
  const database = join(directory, 'control-plane.sqlite3')
  const allow = { authorize: async () => true }
  try {
    let repository = await openSqliteTenantControlRepository(database, migration)
    let service = new TenantControlServiceV1(repository, allow)
    for (const context of [alpha, beta]) {
      await service.createTenant(context, { name: context.tenantId }, at)
      await service.registerUser(context, { userId: 'owner', displayName: 'Owner' }, at)
      await service.registerDevice(context, { deviceId: 'device.one', publicKey: `public-${context.tenantId}` }, at)
    }
    await service.registerUser(alpha, { userId: 'member', displayName: 'Member' }, at)
    const member: TenantContextV1 = { tenantId: 'alpha', userId: 'member', roles: ['member'] }
    await service.registerDevice(member, { deviceId: 'device.member', publicKey: 'public-member' }, at)
    assert.deepEqual((await service.listDevices(member)).map(item => item.deviceId), ['device.member'])
    assert.deepEqual((await service.listDevices(alpha)).map(item => item.publicKey), ['public-member', 'public-alpha'])
    assert.deepEqual((await service.listDevices(beta)).map(item => item.publicKey), ['public-beta'])
    await repository.close()

    repository = await openSqliteTenantControlRepository(database, migration)
    service = new TenantControlServiceV1(repository, allow)
    assert.deepEqual((await service.listDevices(alpha)).map(item => item.deviceId), ['device.member', 'device.one'])
    await repository.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('fails closed on denied authorization, foreign users and device identity drift', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-cp-'))
  const repository = await openSqliteTenantControlRepository(join(directory, 'control-plane.sqlite3'), migration)
  try {
    const denied = new TenantControlServiceV1(repository, { authorize: async ({ action }) => action !== 'device.register' })
    await denied.createTenant(alpha, { name: 'Alpha' }, at)
    await denied.registerUser(alpha, { userId: 'owner', displayName: 'Owner' }, at)
    await assert.rejects(() => denied.registerDevice(alpha, { deviceId: 'device.one', publicKey: 'public-alpha' }, at), /not authorized/)

    const service = new TenantControlServiceV1(repository, { authorize: async () => true })
    await service.registerDevice(alpha, { deviceId: 'device.one', publicKey: 'public-alpha' }, at)
    await assert.rejects(() => service.registerDevice(alpha, { deviceId: 'device.one', publicKey: 'different' }, at), /immutable/)
    await assert.rejects(() => service.registerDevice({ tenantId: 'missing', userId: 'owner', roles: ['member'] }, { deviceId: 'device.one', publicKey: 'public' }, at), /tenant is unavailable/)
  } finally { await repository.close(); await rm(directory, { recursive: true, force: true }) }
})
