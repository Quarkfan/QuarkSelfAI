import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defineCapabilityManifest } from '../src/capability-sdk/index.js'
import { contentDigest } from '../src/capability-platform/validation.js'
import type { ManifestPublicationCandidateV1 } from '../src/capability-platform/artifact-candidates.js'
import type { TenantContextV1 } from '../src/control-plane/contracts.js'
import { openSqliteInactiveCapabilityRegistry } from '../src/control-plane/sqlite-capability-registry.js'
import { openSqliteTenantControlRepository } from '../src/control-plane/sqlite-tenant-repository.js'
import { TenantControlServiceV1 } from '../src/control-plane/tenant-service.js'

const migrations = [
  new URL('../migrations/control-plane-sqlite/001_tenant_identity.sql', import.meta.url).pathname,
  new URL('../migrations/control-plane-sqlite/003_capability_registry.sql', import.meta.url).pathname,
]
const sha = `sha256:${'a'.repeat(64)}`
const at = new Date('2026-09-06T00:00:00.000Z')
const owner: TenantContextV1 = { tenantId: 'test.alpha', userId: 'owner', roles: ['owner'] }
const member: TenantContextV1 = { tenantId: 'test.alpha', userId: 'member', roles: ['member'] }
const other: TenantContextV1 = { tenantId: 'test.beta', userId: 'owner', roles: ['owner'] }

function candidate(id: string, version: string): ManifestPublicationCandidateV1 {
  const lifecycle = Object.fromEntries(['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => [action, { handlerInterface: `lifecycle.${action}`, supported: true, approval: action === 'stop' ? 'none' : 'install' }]))
  const manifest = defineCapabilityManifest({
    schemaVersion: 1, id, name: 'Portable Tool', version, kind: 'cli', description: 'A portable, verified command line capability.',
    source: { kind: 'git', locator: 'https://example.invalid/tool.git', revision: 'revision-1', artifactDigest: sha, license: 'Apache-2.0', supplier: 'example', signature: { status: 'verified', keyId: 'release-key' }, sbom: { format: 'spdx', digest: sha } },
    runtime: { placements: ['local'], isolation: 'process', supportedPlatforms: ['darwin-arm64'], executorRequirements: [], stateNamespace: 'tool.portable', offlineCapable: true },
    requirements: [], lifecycle,
    interfaces: ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover'].map(action => ({ kind: 'runtime', id: `lifecycle.${action}`, version: '1.0.0', direction: 'provides', compatibility: ['1'] })),
    dependencies: [], permissions: [], dataClasses: [], tests: [{ id: 'contract.default', kind: 'contract', required: true, effectMode: 'none' }],
    healthChecks: [], recovery: { strategy: 'reinstall', rollbackVersion: null, stateIncluded: false, restoreEffectsEnabled: false },
  })
  return Object.freeze({ schemaVersion: 1, candidateId: manifest.id, manifest, manifestDigest: contentDigest(manifest), evidencePolicyRevision: 'policy-1', status: 'validated-unpublished', publicationAllowed: false, activationAllowed: false, currentOwnerPreserved: true })
}

function evidence(value: ManifestPublicationCandidateV1) {
  return { schemaVersion: 1 as const, capabilityId: value.manifest.id, version: value.manifest.version, artifactDigest: value.manifest.source.artifactDigest,
    sourceRevision: value.manifest.source.revision, policyRevision: value.evidencePolicyRevision, evaluatedAt: at.toISOString(), decision: 'verified' as const,
    checks: { license: 'pass' as const, signature: 'pass' as const, sbom: 'pass' as const, malware: 'pass' as const, maintenance: 'pass' as const, dependencies: 'pass' as const } }
}

async function provision(database: string): Promise<void> {
  const repository = await openSqliteTenantControlRepository(database, migrations[0]!)
  const service = new TenantControlServiceV1(repository, { authorize: async () => true })
  for (const context of [owner, other]) await service.createTenant(context, { name: context.tenantId }, at)
  await service.registerUser(owner, { userId: 'owner', displayName: 'Owner' }, at)
  await service.registerUser(owner, { userId: 'member', displayName: 'Member' }, at)
  await service.registerUser(other, { userId: 'owner', displayName: 'Owner' }, at)
  await repository.close()
}

test('persists inactive releases with private, tenant and cross-tenant visibility isolation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-registry-'))
  const database = join(directory, 'control-plane.sqlite3')
  const allow = { authorize: async () => true }
  try {
    await provision(database)
    let registry = await openSqliteInactiveCapabilityRegistry(database, migrations, allow)
    const privateCandidate = candidate('tool/private', '1.0.0'); const sharedCandidate = candidate('tool/shared', '1.0.0')
    const privateRelease = await registry.registerInactive(owner, { candidate: privateCandidate, evidence: evidence(privateCandidate), visibility: 'private' }, at)
    const tenantRelease = await registry.registerInactive(owner, { candidate: sharedCandidate, evidence: evidence(sharedCandidate), visibility: 'tenant' }, at)
    await registry.registerInactive(other, { candidate: sharedCandidate, evidence: evidence(sharedCandidate), visibility: 'tenant' }, at)
    assert.equal(privateRelease.consumerCount, 0); assert.equal(privateRelease.externalWritesEnabled, false)
    assert.deepEqual((await registry.listVisible(member)).map(item => item.manifest.id), ['tool/shared'])
    assert.equal((await registry.get(member, privateRelease.manifest.id, privateRelease.manifest.version)), undefined)
    assert.equal((await registry.get(other, tenantRelease.manifest.id, tenantRelease.manifest.version))?.tenantId, 'test.beta')
    await registry.close()

    registry = await openSqliteInactiveCapabilityRegistry(database, migrations, allow)
    assert.deepEqual((await registry.listVisible(owner)).map(item => item.manifest.id), ['tool/private', 'tool/shared'])
    assert.deepEqual(await registry.registerInactive(owner, { candidate: privateCandidate, evidence: evidence(privateCandidate), visibility: 'private' }, at), privateRelease)
    await assert.rejects(() => registry.registerInactive(owner, { candidate: privateCandidate, evidence: evidence(privateCandidate), visibility: 'tenant' }, at), /different content/)
    await registry.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rejects denied, publish-enabled and private integration candidates before persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-registry-'))
  const database = join(directory, 'control-plane.sqlite3')
  try {
    await provision(database)
    const denied = await openSqliteInactiveCapabilityRegistry(database, migrations, { authorize: async () => false })
    const deniedCandidate = candidate('tool/denied', '1.0.0')
    await assert.rejects(() => denied.registerInactive(owner, { candidate: deniedCandidate, evidence: evidence(deniedCandidate), visibility: 'private' }, at), /not authorized/)
    await denied.close()

    const registry = await openSqliteInactiveCapabilityRegistry(database, migrations, { authorize: async () => true })
    const unsafe = candidate('tool/unsafe', '1.0.0')
    await assert.rejects(() => registry.registerInactive(owner, { candidate: { ...unsafe, publicationAllowed: true }, evidence: evidence(unsafe), visibility: 'private' }, at), /not safe/)
    const integration = candidate('integration/private', '1.0.0')
    await assert.rejects(() => registry.registerInactive(owner, { candidate: { ...integration, manifest: { ...integration.manifest, kind: 'integration-pack' } }, evidence: evidence(integration), visibility: 'private' }, at), /integration|digest/)
    assert.deepEqual(await registry.listVisible(owner), [])
    await registry.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
