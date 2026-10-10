import assert from 'node:assert/strict'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { defineAgentBlueprint } from '../src/capability-sdk/index.js'
import { bootstrapFirstCloudOwnerV1 } from '../src/control-plane/cloud-owner-bootstrap.js'
import { InactiveCloudControlPlaneCompositionV1 } from '../src/control-plane/cloud-composition.js'
import { RoleTenantAuthorizationV1 } from '../src/control-plane/tenant-service.js'

const migration = (name: string) => new URL(`../migrations/control-plane-sqlite/${name}`, import.meta.url).pathname
const migrations = { tenant: migration('001_tenant_identity.sql'), studio: migration('002_agent_studio.sql'), capability: migration('003_capability_registry.sql'), deviceSession: migration('004_device_sessions.sql'), deviceEnrollment: migration('005_device_enrollment.sql'), identity: migration('006_cloud_identity.sql'), identityAdministration: migration('007_identity_administration.sql') }
const now = new Date('2026-09-06T00:00:00.000Z')

test('opens one real-tenant inactive provider graph and derives every HTTP scope from login', async () => {
  const createdRoot = await mkdtemp(join(tmpdir(), 'quark-cloud-composition-')); await chmod(createdRoot, 0o700); const root = await realpath(createdRoot)
  const databasePath = join(root, 'control-plane.sqlite3')
  try {
    await bootstrapFirstCloudOwnerV1({ schemaVersion: 1, databasePath, tenantMigrationPath: migrations.tenant, identityMigrationPath: migrations.identity, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }, 'synthetic-password', now)
    let token = 0
    const composition = await InactiveCloudControlPlaneCompositionV1.open({ schemaVersion: 1, databasePath, migrations, listenerEnabled: false, externalEffectsEnabled: false }, {
      tokens: { next: label => `${label}.${++token}` }, orchestrationIds: { next: label => `${label}.${++token}` }, proofVerifier: { async verify() { return true } }, planVerifier: { async verify() { return true } }, planSigner: { keyId: 'control.primary', async sign() { return 'c2lnbmF0dXJl' } },
    })
    try {
      const login = await composition.http.handle({ method: 'POST', path: '/v1/auth/login', body: { tenantId: 'tenant.alpha', userId: 'owner', password: 'synthetic-password' } })
      assert.equal(login.status, 201)
      const sessionReference = ((login.body.session as { sessionReference: string }).sessionReference)
      for (const path of ['/v1/devices', '/v1/capabilities', '/v1/agent-drafts']) assert.equal((await composition.http.handle({ method: 'GET', path, sessionReference })).status, 200)
      const created = await composition.http.handle({ method: 'POST', path: '/v1/users', sessionReference, body: { userId: 'member.one', displayName: 'Member One', password: 'member-password-123', roles: ['member'] } })
      assert.equal(created.status, 201); assert.equal((created.body.item as { credentialRetained: boolean }).credentialRetained, false)
      const memberLogin = await composition.http.handle({ method: 'POST', path: '/v1/auth/login', body: { tenantId: 'tenant.alpha', userId: 'member.one', password: 'member-password-123' } })
      assert.equal(memberLogin.status, 201)
      const memberSession = (memberLogin.body.session as { sessionReference: string }).sessionReference
      assert.equal((await composition.http.handle({ method: 'POST', path: '/v1/users', sessionReference: memberSession, body: { userId: 'forbidden', displayName: 'Forbidden', password: 'forbidden-password-123', roles: ['member'] } })).status, 403)
      assert.equal((await composition.http.handle({ method: 'POST', path: '/v1/users', sessionReference, body: { tenantId: 'tenant.other', userId: 'injected', displayName: 'Injected', password: 'injected-password-123', roles: ['member'] } })).status, 400)
      assert.equal((await composition.http.handle({ method: 'POST', path: '/v1/devices', sessionReference, body: { deviceId: 'device.owner', publicKey: 'ed25519-spki:owner' } })).status, 201)
      const blueprint = defineAgentBlueprint({
        schemaVersion: 1, id: 'agent/basic', name: 'Basic Agent', version: '1.0.0', revision: 'r1', releaseState: 'test', role: 'assistant', goals: ['Return a bounded result'], capabilities: [], graph: { nodes: [], edges: [] },
        triggers: [{ id: 'manual', kind: 'manual', specification: 'console', enabled: true }], executorPolicy: { preferred: ['claude-code'], fallback: ['codex', 'dsh'], allowInfrastructureFallback: true, allowMidActionSwitch: false, preserveSessionContinuity: true },
        deviceSelector: 'device:owner', workspaceHandles: [], permissions: [], modelPolicy: { allowed: ['provider-neutral'], preferred: null }, budget: { tokens: 1000, durationMs: 60000, costMinorUnits: 0 }, retry: { infrastructureAttempts: 2, deterministicAttempts: 1 },
        notifications: { channels: ['console'], on: ['completion'] }, retention: { localRawDays: 1, cloudSummaryDays: 7 },
      })
      assert.equal((await composition.http.handle({ method: 'POST', path: '/v1/agent-drafts', sessionReference, body: { draftId: 'draft.basic', blueprint, expectedRevision: 0 } })).status, 201)
      assert.equal((await composition.http.handle({ method: 'POST', path: '/v1/agent-drafts/publish-test', sessionReference, body: { draftId: 'draft.basic', expectedRevision: 1 } })).status, 201)
      const dispatch = await composition.http.handle({ method: 'POST', path: '/v1/agent-drafts/dispatch-test', sessionReference, body: { draftId: 'draft.basic', expectedRevision: 1, deviceId: 'device.owner' } })
      assert.equal(dispatch.status, 201, JSON.stringify(dispatch.body)); assert.equal((dispatch.body.item as { externalWritesEnabled: boolean }).externalWritesEnabled, false)
      assert.equal((await composition.http.handle({ method: 'POST', path: '/v1/agent-drafts/dispatch-test', sessionReference: memberSession, body: { draftId: 'draft.basic', expectedRevision: 1, deviceId: 'device.owner' } })).status, 422)
      const evidence = new DatabaseSync(databasePath, { readOnly: true })
      try {
        assert.deepEqual({ ...evidence.prepare('SELECT actor_user_id, target_user_id, action, roles_json FROM cp_identity_admin_audit').get() }, { actor_user_id: 'owner', target_user_id: 'member.one', action: 'account.provision', roles_json: '["member"]' })
        assert.equal((evidence.prepare('SELECT COUNT(*) AS count FROM cp_user WHERE tenant_id=?').get('tenant.alpha') as { count: number }).count, 2)
        assert.deepEqual({ ...evidence.prepare('SELECT tenant_id, user_id, device_id, state FROM cp_device_dispatch').get() }, { tenant_id: 'tenant.alpha', user_id: 'owner', device_id: 'device.owner', state: 'queued' })
      } finally { evidence.close() }
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
  const dependencies = { tokens: { next: () => 'token.one' }, orchestrationIds: { next: () => 'token.one' }, proofVerifier: { async verify() { return true } }, planVerifier: { async verify() { return true } }, planSigner: { keyId: 'control.primary', async sign({ payloadDigest }: { payloadDigest: string }) { return `signed:${payloadDigest}` } } }
  try {
    await bootstrapFirstCloudOwnerV1({ schemaVersion: 1, databasePath, tenantMigrationPath: migrations.tenant, identityMigrationPath: migrations.identity, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }, 'synthetic-password', now)
    const config = { schemaVersion: 1, databasePath, migrations, listenerEnabled: false, externalEffectsEnabled: false } as const
    await assert.rejects(() => InactiveCloudControlPlaneCompositionV1.open({ ...config, listenerEnabled: true }, dependencies), /remain inactive/)
    await assert.rejects(() => InactiveCloudControlPlaneCompositionV1.open({ ...config, unexpected: true }, dependencies), /remain inactive/)
    await chmod(databasePath, 0o644)
    await assert.rejects(() => InactiveCloudControlPlaneCompositionV1.open(config, dependencies), /database is unsafe/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
