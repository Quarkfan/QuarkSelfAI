import assert from 'node:assert/strict'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bootstrapFirstCloudOwnerV1 } from '../src/control-plane/cloud-owner-bootstrap.js'
import { PreparedCloudTransportHostV1 } from '../src/control-plane/cloud-transport-host.js'
import { DeviceProtocolFrameDecoderV1, encodeDeviceProtocolFrame } from '../src/client-runtime/device-codec.js'

const migration = (name: string) => new URL(`../migrations/control-plane-sqlite/${name}`, import.meta.url).pathname
const migrations = { tenant: migration('001_tenant_identity.sql'), studio: migration('002_agent_studio.sql'), capability: migration('003_capability_registry.sql'), deviceSession: migration('004_device_sessions.sql'), deviceEnrollment: migration('005_device_enrollment.sql'), identity: migration('006_cloud_identity.sql'), identityAdministration: migration('007_identity_administration.sql') }
const now = new Date('2026-09-06T00:00:00.000Z')

test('binds prepared HTTP and SSH adapters to one inactive provider graph', async () => {
  const created = await mkdtemp(join(tmpdir(), 'quark-cloud-host-')); await chmod(created, 0o700); const root = await realpath(created); const databasePath = join(root, 'control.sqlite3')
  try {
    await bootstrapFirstCloudOwnerV1({ schemaVersion: 1, databasePath, tenantMigrationPath: migrations.tenant, identityMigrationPath: migrations.identity, tenantId: 'tenant.alpha', tenantName: 'Alpha', userId: 'owner', displayName: 'Owner' }, 'synthetic-password', now)
    let token = 0; const composition = { schemaVersion: 1, databasePath, migrations, listenerEnabled: false, externalEffectsEnabled: false } as const
    const host = await PreparedCloudTransportHostV1.open({ schemaVersion: 1, composition, directTls: 'prepared-inactive', sshSubsystem: 'prepared-inactive', singleProvider: true, activationAllowed: false }, { tokens: { next: label => `${label}.${++token}` }, proofVerifier: { async verify() { return true } }, planVerifier: { async verify() { return true } } })
    try {
      const login = await host.handleHttp({ method: 'POST', path: '/v1/auth/login', body: { tenantId: 'tenant.alpha', userId: 'owner', password: 'synthetic-password' } }); const sessionReference = (login.body.session as { sessionReference: string }).sessionReference
      assert.equal((await host.handleHttp({ method: 'POST', path: '/v1/devices', sessionReference, body: { deviceId: 'device.owner', publicKey: 'public-key' } })).status, 201)
      const request = encodeDeviceProtocolFrame({ schemaVersion: 1, frameId: 'frame.client.one', causationId: null, tenantId: 'tenant.alpha', userId: 'owner', deviceId: 'device.owner', sentAt: now.toISOString(), payload: { kind: 'client.hello', protocol: 'quark-device-sync.v1', transport: 'ssh-subsystem', executorReportDigests: [] } })
      const decoder = new DeviceProtocolFrameDecoderV1(); const messages = decoder.push(await host.handleSshFrame(request, now))
      assert.equal(messages.length, 1); assert.equal(messages[0]!.payload.kind, 'server.challenge'); assert.equal(messages[0]!.causationId, 'frame.client.one')
    } finally { await host.close() }
    await assert.rejects(() => PreparedCloudTransportHostV1.open({ schemaVersion: 1, composition, directTls: 'active', sshSubsystem: 'prepared-inactive', singleProvider: true, activationAllowed: false }, {} as never), /remain single-provider and inactive/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
