import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'
import { InactiveCloudControlPlaneApplicationV1 } from '../src/control-plane/cloud-application.js'
import { InactiveCloudHttpHandlerV1 } from '../src/control-plane/http-handler.js'
import { openEphemeralLoopbackCloudEdge } from '../src/control-plane/node-http-adapter.js'
import { openSqliteInactiveAgentStudio } from '../src/control-plane/sqlite-agent-studio.js'
import { openSqliteInactiveCapabilityRegistry } from '../src/control-plane/sqlite-capability-registry.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

const root = resolve(new URL('..', import.meta.url).pathname)
const identityMigration = join(root, 'migrations/control-plane-sqlite/001_tenant_identity.sql')
const studioMigration = join(root, 'migrations/control-plane-sqlite/002_agent_studio.sql')
const capabilityMigration = join(root, 'migrations/control-plane-sqlite/003_capability_registry.sql')
const contexts: readonly TenantContextV1[] = [
  { tenantId: 'test.edge-alpha', userId: 'user.owner', roles: ['owner'] },
  { tenantId: 'test.edge-beta', userId: 'user.owner', roles: ['owner'] },
]

export async function runCapabilityPlatformCloudEdgePilot(now = new Date()) {
  const directory = await mkdtemp(join(tmpdir(), 'quark-cloud-edge-'))
  const database = join(directory, 'control-plane.sqlite3')
  const authorization = { authorize: async () => true }
  let listenerClosed = false
  let requestCount = 0
  try {
    let identities = await openSqliteTenantControlRepository(database, identityMigration)
    let devices = new TenantControlServiceV1(identities, authorization)
    for (const context of contexts) {
      await devices.createTenant(context, { name: context.tenantId }, now)
      await devices.registerUser(context, { userId: context.userId, displayName: 'Synthetic Owner' }, now)
    }
    await identities.close()

    identities = await openSqliteTenantControlRepository(database, identityMigration)
    devices = new TenantControlServiceV1(identities, authorization)
    const capabilities = await openSqliteInactiveCapabilityRegistry(database, [identityMigration, capabilityMigration], authorization)
    const studio = await openSqliteInactiveAgentStudio(database, [identityMigration, studioMigration], authorization)
    const identity = { resolveSession: async (reference: string) => reference === 'session:edge-alpha' ? contexts[0] : reference === 'session:edge-beta' ? contexts[1] : undefined }
    const application = new InactiveCloudControlPlaneApplicationV1(identity, capabilities, studio, devices)
    const edge = await openEphemeralLoopbackCloudEdge(new InactiveCloudHttpHandlerV1(application))
    const base = `http://${edge.host}:${edge.port}`
    try {
      const created = await Promise.all([
        json(base, 'POST', '/v1/devices', 'session:edge-alpha', { deviceId: 'device.owner', publicKey: 'public.edge-alpha' }),
        json(base, 'POST', '/v1/devices', 'session:edge-beta', { deviceId: 'device.owner', publicKey: 'public.edge-beta' }),
      ])
      if (created.some(value => value.status !== 201)) throw new Error('synthetic device registration failed')
      const [alphaDevices, betaDevices, alphaCapabilities, betaDrafts] = await Promise.all([
        json(base, 'GET', '/v1/devices', 'session:edge-alpha'), json(base, 'GET', '/v1/devices', 'session:edge-beta'),
        json(base, 'GET', '/v1/capabilities', 'session:edge-alpha'), json(base, 'GET', '/v1/agent-drafts', 'session:edge-beta'),
      ])
      const injection = await json(base, 'POST', '/v1/devices', 'session:edge-alpha', { tenantId: 'test.edge-beta', deviceId: 'device.injected', publicKey: 'public.injected' })
      assertOneScopedDevice(alphaDevices, 'test.edge-alpha')
      assertOneScopedDevice(betaDevices, 'test.edge-beta')
      if (alphaCapabilities.status !== 200 || betaDrafts.status !== 200 || injection.status !== 400) throw new Error('cloud edge boundary evidence failed')
      requestCount = edge.requestCount()
    } finally {
      await edge.close()
      listenerClosed = true
      await Promise.all([capabilities.close(), studio.close(), identities.close()])
    }

    const reopened = await openSqliteTenantControlRepository(database, identityMigration)
    const reopenedService = new TenantControlServiceV1(reopened, authorization)
    const persistedCounts = await Promise.all(contexts.map(context => reopenedService.listDevices(context).then(items => items.length)))
    await reopened.close()
    if (persistedCounts.some(count => count !== 1)) throw new Error('tenant-isolated devices did not survive SQLite reopen')
    return Object.freeze({ schemaVersion: 1, requestId: 'capability-platform-cloud-edge-pilot-03', tenantCount: 2, deviceCounts: persistedCounts,
      requestCount, tenantInjectionRejected: true, databaseReopened: true, listenerClosed, executorInvoked: false, effectsActive: 0,
      externalWritesEnabled: false, currentOwnerPreserved: true, runtimeCompositionChanged: false, serviceRestarted: false })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function json(base: string, method: 'GET' | 'POST', path: string, session: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'x-quark-session': session, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function assertOneScopedDevice(response: Awaited<ReturnType<typeof json>>, tenantId: string): void {
  const items = response.body.items
  if (response.status !== 200 || !Array.isArray(items) || items.length !== 1 || (items[0] as Record<string, unknown>).tenantId !== tenantId) throw new Error('tenant device isolation failed')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCapabilityPlatformCloudEdgePilot().then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`), error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
