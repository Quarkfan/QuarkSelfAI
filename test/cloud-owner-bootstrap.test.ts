import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bootstrapFirstCloudOwnerV1 } from '../src/control-plane/cloud-owner-bootstrap.js'
import { openSqliteCloudIdentityProvider } from '../src/control-plane/sqlite-cloud-identity.js'

const tenantMigration = new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname
const identityMigration = new URL('../migrations/control-plane-sqlite/006_cloud_identity.sql', import.meta.url).pathname
const now = new Date('2026-09-06T00:00:00.000Z')

test('creates exactly one first tenant owner atomically without retaining its credential', async () => {
  const createdRoot = await mkdtemp(join(tmpdir(), 'quark-cloud-bootstrap-')); await chmod(createdRoot, 0o700); const root = await realpath(createdRoot)
  const databasePath = join(root, 'control-plane.sqlite3')
  const input = { schemaVersion: 1 as const, databasePath, tenantMigrationPath: tenantMigration, identityMigrationPath: identityMigration, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }
  try {
    const receipt = await bootstrapFirstCloudOwnerV1(input, 'synthetic-password', now)
    assert.deepEqual(receipt, { schemaVersion: 1, tenantId: 'tenant.alpha', userId: 'owner', state: 'created', roles: ['owner'], createdAt: now.toISOString(), passwordRetained: false, sessionCreated: false })
    assert.equal((await import('node:fs/promises').then(module => module.lstat(databasePath))).mode & 0o077, 0)
    assert.equal((await readFile(databasePath)).includes(Buffer.from('synthetic-password')), false)
    const identity = await openSqliteCloudIdentityProvider(databasePath, [tenantMigration, identityMigration])
    const authenticated = await identity.authenticate({ tenantId: 'tenant.alpha', userId: 'owner', password: 'synthetic-password' }, now)
    assert.deepEqual(await identity.resolveSession(authenticated.sessionReference, now), { tenantId: 'tenant.alpha', userId: 'owner', roles: ['owner'] })
    await identity.close()
    await assert.rejects(() => bootstrapFirstCloudOwnerV1(input, 'another-password', now), /empty identity database/)
    await assert.rejects(() => bootstrapFirstCloudOwnerV1({ ...input, roles: ['owner'] }, 'another-password', now), /input is invalid/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rolls back tenant and user when credential validation fails', async () => {
  const createdRoot = await mkdtemp(join(tmpdir(), 'quark-cloud-bootstrap-')); await chmod(createdRoot, 0o700); const root = await realpath(createdRoot)
  const databasePath = join(root, 'control-plane.sqlite3')
  const input = { schemaVersion: 1 as const, databasePath, tenantMigrationPath: tenantMigration, identityMigrationPath: identityMigration, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }
  try {
    await assert.rejects(() => bootstrapFirstCloudOwnerV1(input, 'short', now), /credential is invalid/)
    const receipt = await bootstrapFirstCloudOwnerV1(input, 'synthetic-password', now)
    assert.equal(receipt.state, 'created')
  } finally { await rm(root, { recursive: true, force: true }) }
})
