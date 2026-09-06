import assert from 'node:assert/strict'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bootstrapFirstCloudOwnerV1 } from '../src/control-plane/cloud-owner-bootstrap.js'
import { InactiveCloudControlPlaneCompositionV1 } from '../src/control-plane/cloud-composition.js'
import { RoleTenantAuthorizationV1 } from '../src/control-plane/tenant-service.js'

const migration = (name: string) => new URL(`../migrations/control-plane-sqlite/${name}`, import.meta.url).pathname
const migrations = { tenant: migration('001_tenant_identity.sql'), studio: migration('002_agent_studio.sql'), capability: migration('003_capability_registry.sql'), deviceSession: migration('004_device_sessions.sql'), deviceEnrollment: migration('005_device_enrollment.sql'), identity: migration('006_cloud_identity.sql') }
const now = new Date('2026-09-06T00:00:00.000Z')

test('opens one real-tenant inactive provider graph and derives every HTTP scope from login', async () => {
  const createdRoot = await mkdtemp(join(tmpdir(), 'quark-cloud-composition-')); await chmod(createdRoot, 0o700); const root = await realpath(createdRoot)
  const databasePath = join(root, 'control-plane.sqlite3')
  try {
    await bootstrapFirstCloudOwnerV1({ schemaVersion: 1, databasePath, tenantMigrationPath: migrations.tenant, identityMigrationPath: migrations.identity, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }, 'synthetic-password', now)
    let token = 0
    const composition = await InactiveCloudControlPlaneCompositionV1.open({ schemaVersion: 1, databasePath, migrations, listenerEnabled: false, externalEffectsEnabled: false }, {
      tokens: { next: label => `${label}.${++token}` }, proofVerifier: { async verify() { return true } }, planVerifier: { async verify() { return true } },
    })
    try {
      const login = await composition.http.handle({ method: 'POST', path: '/v1/auth/login', body: { tenantId: 'tenant.alpha', userId: 'owner', password: 'synthetic-password' } })
      assert.equal(login.status, 201)
      const sessionReference = ((login.body.session as { sessionReference: string }).sessionReference)
      for (const path of ['/v1/devices', '/v1/capabilities', '/v1/agent-drafts']) assert.equal((await composition.http.handle({ method: 'GET', path, sessionReference })).status, 200)
      assert.equal((await composition.http.handle({ method: 'GET', path: '/v1/devices', sessionReference: 'session:missing' })).status, 401)
    } finally { await composition.close() }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('uses a closed tenant role matrix without an administrator bypass', async () => {
  const authorization = new RoleTenantAuthorizationV1(); const context = { tenantId: 'tenant.alpha', userId: 'auditor', roles: ['auditor'] as const }
  assert.equal(await authorization.authorize({ context, action: 'capability-release.read', subjectRef: 'capabilities:tenant:tenant.alpha' }), true)
  assert.equal(await authorization.authorize({ context, action: 'capability-release.register-inactive', subjectRef: 'capability:tool.one' }), false)
  assert.equal(await authorization.authorize({ context: { ...context, roles: ['member'] }, action: 'tenant.create', subjectRef: 'tenant:tenant.alpha' }), false)
  await assert.rejects(() => authorization.authorize({ context: { ...context, roles: ['owner', 'administrator'] as never }, action: 'tenant.create', subjectRef: 'tenant:tenant.alpha' }), /roles are invalid/)
})

test('refuses activation flags, unknown config and unsafe database permissions before opening providers', async () => {
  const createdRoot = await mkdtemp(join(tmpdir(), 'quark-cloud-composition-')); await chmod(createdRoot, 0o700); const root = await realpath(createdRoot)
  const databasePath = join(root, 'control-plane.sqlite3')
  const dependencies = { tokens: { next: () => 'token.one' }, proofVerifier: { async verify() { return true } }, planVerifier: { async verify() { return true } } }
  try {
    await bootstrapFirstCloudOwnerV1({ schemaVersion: 1, databasePath, tenantMigrationPath: migrations.tenant, identityMigrationPath: migrations.identity, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }, 'synthetic-password', now)
    const config = { schemaVersion: 1, databasePath, migrations, listenerEnabled: false, externalEffectsEnabled: false } as const
    await assert.rejects(() => InactiveCloudControlPlaneCompositionV1.open({ ...config, listenerEnabled: true }, dependencies), /remain inactive/)
    await assert.rejects(() => InactiveCloudControlPlaneCompositionV1.open({ ...config, unexpected: true }, dependencies), /remain inactive/)
    await chmod(databasePath, 0o644)
    await assert.rejects(() => InactiveCloudControlPlaneCompositionV1.open(config, dependencies), /database is unsafe/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
