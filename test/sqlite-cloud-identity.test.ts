import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openSqliteCloudIdentityProvider } from '../src/control-plane/sqlite-cloud-identity.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

const migrations = ['001_tenant_identity.sql', '006_cloud_identity.sql'].map(name => new URL(`../migrations/control-plane-sqlite/${name}`, import.meta.url).pathname)
const at = new Date('2026-09-06T00:00:00.000Z')

test('authenticates identical user ids into isolated tenant sessions without storing raw credentials', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'quark-cloud-identity-'))); const database = join(root, 'control.sqlite3')
  const repository = await openSqliteTenantControlRepository(database, migrations[0]!); const authorization = { authorize: async () => true }; const tenants = new TenantControlServiceV1(repository, authorization)
  const alpha = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] as const }; const beta = { tenantId: 'test.beta', userId: 'user.owner', roles: ['owner'] as const }
  try {
    for (const context of [alpha, beta]) { await tenants.createTenant(context, { name: context.tenantId }, at); await tenants.registerUser(context, { userId: context.userId, displayName: 'Synthetic Owner' }, at) }
    await repository.close()
    const identity = await openSqliteCloudIdentityProvider(database, migrations)
    await identity.provisionAccount({ ...alpha, password: 'alpha-password-123' }, at); await identity.provisionAccount({ ...beta, password: 'beta-password-456' }, at)
    await assert.rejects(identity.authenticate({ tenantId: alpha.tenantId, userId: alpha.userId, password: 'wrong-password-000' }, at), /authentication failed/)
    const alphaSession = await identity.authenticate({ tenantId: alpha.tenantId, userId: alpha.userId, password: 'alpha-password-123' }, at)
    const betaSession = await identity.authenticate({ tenantId: beta.tenantId, userId: beta.userId, password: 'beta-password-456' }, at)
    assert.notEqual(alphaSession.sessionReference, betaSession.sessionReference)
    assert.deepEqual(await identity.resolveSession(alphaSession.sessionReference, at), alpha); assert.deepEqual(await identity.resolveSession(betaSession.sessionReference, at), beta)
    assert.equal(await identity.resolveSession(alphaSession.sessionReference, new Date('2026-09-06T08:00:00.001Z')), undefined)
    await identity.revoke(betaSession.sessionReference, at); assert.equal(await identity.resolveSession(betaSession.sessionReference, at), undefined)
    await identity.close()
    const bytes = await readFile(database); const text = bytes.toString('latin1')
    for (const raw of ['alpha-password-123', 'beta-password-456', alphaSession.sessionReference, betaSession.sessionReference]) assert.equal(text.includes(raw), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('fails closed on duplicate accounts, weak passwords and unknown sessions', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'quark-cloud-identity-'))); const database = join(root, 'control.sqlite3')
  try {
    const repository = await openSqliteTenantControlRepository(database, migrations[0]!); const context = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] as const }; const tenants = new TenantControlServiceV1(repository, { authorize: async () => true })
    await tenants.createTenant(context, { name: 'Test Alpha' }, at); await tenants.registerUser(context, { userId: context.userId, displayName: 'Synthetic Owner' }, at); await repository.close()
    const identity = await openSqliteCloudIdentityProvider(database, migrations)
    await assert.rejects(identity.provisionAccount({ ...context, password: 'short' }, at), /authentication failed/)
    await identity.provisionAccount({ ...context, password: 'safe-password-123' }, at)
    await assert.rejects(identity.provisionAccount({ ...context, password: 'safe-password-123' }, at), /already exists/)
    assert.equal(await identity.resolveSession('session:not-a-token', at), undefined)
    await identity.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('persists a bounded login throttle and clears it only after a successful login', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'quark-cloud-identity-'))); const database = join(root, 'control.sqlite3'); const context = { tenantId: 'test.alpha', userId: 'user.owner', roles: ['owner'] as const }
  try {
    const repository = await openSqliteTenantControlRepository(database, migrations[0]!); const tenants = new TenantControlServiceV1(repository, { authorize: async () => true }); await tenants.createTenant(context, { name: 'Test Alpha' }, at); await tenants.registerUser(context, { userId: context.userId, displayName: 'Synthetic Owner' }, at); await repository.close()
    let identity = await openSqliteCloudIdentityProvider(database, migrations); await identity.provisionAccount({ ...context, password: 'safe-password-123' }, at)
    for (let attempt = 0; attempt < 5; attempt += 1) await assert.rejects(identity.authenticate({ tenantId: context.tenantId, userId: context.userId, password: 'wrong-password-000' }, new Date(at.getTime() + attempt * 1000)), /authentication failed/)
    await identity.close(); identity = await openSqliteCloudIdentityProvider(database, migrations)
    await assert.rejects(identity.authenticate({ tenantId: context.tenantId, userId: context.userId, password: 'safe-password-123' }, new Date(at.getTime() + 10_000)), /authentication failed/)
    const session = await identity.authenticate({ tenantId: context.tenantId, userId: context.userId, password: 'safe-password-123' }, new Date(at.getTime() + 16 * 60_000))
    assert.deepEqual(await identity.resolveSession(session.sessionReference, new Date(at.getTime() + 16 * 60_000)), context)
    await identity.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})
