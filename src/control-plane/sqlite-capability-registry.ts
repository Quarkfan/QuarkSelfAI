import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { contentDigest, validateCapabilityManifest } from '../capability-platform/validation.js'
import type { ManifestPublicationCandidateV1 } from '../capability-platform/artifact-candidates.js'
import type { ArtifactVerificationReportV1 } from '../client-runtime/contracts.js'
import type { CapabilityCatalogRecordV1, PersistentCapabilityRegistryPortV1, TenantContextV1 } from './contracts.js'
import type { TenantAuthorizationPortV1, TenantControlActionV1 } from './tenant-persistence.js'

type Row = Record<string, string | number>
const idPattern = /^[a-z0-9][a-z0-9./-]{0,127}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const requiredChecks = ['license', 'signature', 'sbom', 'malware', 'maintenance', 'dependencies'] as const

/** Persistent catalog only: no installation, loading, authorization, execution, scheduling, or effect ownership. */
export class SqliteInactiveCapabilityRegistryV1 implements PersistentCapabilityRegistryPortV1 {
  constructor(private readonly database: DatabaseSync, private readonly authorization: TenantAuthorizationPortV1) {}

  async registerInactive(context: TenantContextV1, input: { readonly candidate: ManifestPublicationCandidateV1; readonly evidence: ArtifactVerificationReportV1; readonly visibility: 'private' | 'tenant' }, now = new Date()): Promise<CapabilityCatalogRecordV1> {
    validateContext(context)
    await this.#authorize(context, 'capability-release.register-inactive', `capability:${input.candidate.candidateId}`)
    const candidate = validateCandidate(input.candidate)
    validateEvidence(candidate, input.evidence)
    if (!['private', 'tenant'].includes(input.visibility)) throw new Error('capability visibility is invalid')
    const existing = this.#get(context.tenantId, candidate.manifest.id, candidate.manifest.version)
    if (existing) {
      if (existing.manifestDigest !== candidate.manifestDigest || existing.visibility !== input.visibility) throw new Error('immutable capability release already exists with different content')
      return visible(existing, context) ? existing : undefinedNever()
    }
    const record = freezeRecord({
      tenantId: context.tenantId, ownerUserId: context.userId, manifest: candidate.manifest,
      manifestDigest: candidate.manifestDigest, evidencePolicyRevision: candidate.evidencePolicyRevision,
      visibility: input.visibility, state: 'catalogued-inactive', registeredAt: validNow(now),
      consumerCount: 0, providerLease: null, schedulerCount: 0, externalWritesEnabled: false,
    })
    this.database.prepare(`INSERT INTO cp_capability_release
      (tenant_id, capability_id, version, owner_user_id, manifest_json, manifest_digest, artifact_digest,
       evidence_policy_revision, visibility, state, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'catalogued-inactive', ?)`).run(
        record.tenantId, record.manifest.id, record.manifest.version, record.ownerUserId, JSON.stringify(record.manifest),
        record.manifestDigest, record.manifest.source.artifactDigest, record.evidencePolicyRevision, record.visibility, record.registeredAt,
      )
    return record
  }

  async get(context: TenantContextV1, capabilityId: string, version: string): Promise<CapabilityCatalogRecordV1 | undefined> {
    validateContext(context); validId(capabilityId, 'capabilityId'); validVersion(version)
    await this.#authorize(context, 'capability-release.read', `capability:${capabilityId}@${version}`)
    const record = this.#get(context.tenantId, capabilityId, version)
    return record && visible(record, context) ? record : undefined
  }

  async listVisible(context: TenantContextV1): Promise<readonly CapabilityCatalogRecordV1[]> {
    validateContext(context)
    await this.#authorize(context, 'capability-release.read', `capabilities:tenant:${context.tenantId}`)
    const rows = this.database.prepare(`SELECT * FROM cp_capability_release
      WHERE tenant_id = ? AND (visibility = 'tenant' OR owner_user_id = ?)
      ORDER BY capability_id, version`).all(context.tenantId, context.userId) as unknown as Row[]
    return Object.freeze(rows.map(recordFromRow))
  }

  async close(): Promise<void> { this.database.close() }

  #get(tenantId: string, capabilityId: string, version: string): CapabilityCatalogRecordV1 | undefined {
    const row = this.database.prepare(`SELECT * FROM cp_capability_release
      WHERE tenant_id = ? AND capability_id = ? AND version = ?`).get(tenantId, capabilityId, version) as Row | undefined
    return row ? recordFromRow(row) : undefined
  }

  async #authorize(context: TenantContextV1, action: TenantControlActionV1, subjectRef: string): Promise<void> {
    if (!await this.authorization.authorize({ context, action, subjectRef })) throw new Error('Capability Registry operation is not authorized')
  }
}

export async function openSqliteInactiveCapabilityRegistry(
  databasePath: string, migrationPaths: readonly string[], authorization: TenantAuthorizationPortV1,
): Promise<SqliteInactiveCapabilityRegistryV1> {
  const path = resolve(databasePath)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(path)
  try {
    for (const migrationPath of migrationPaths) database.exec(await readFile(resolve(migrationPath), 'utf8'))
    return new SqliteInactiveCapabilityRegistryV1(database, authorization)
  } catch (error) { database.close(); throw error }
}

function validateCandidate(value: ManifestPublicationCandidateV1): ManifestPublicationCandidateV1 {
  if (value.schemaVersion !== 1 || value.status !== 'validated-unpublished' || value.publicationAllowed || value.activationAllowed || !value.currentOwnerPreserved) throw new Error('manifest candidate is not safe for inactive registration')
  const manifest = validateCapabilityManifest(value.manifest)
  if (manifest.kind === 'integration-pack') throw new Error('private integration manifests cannot enter the core registry')
  if (value.candidateId !== manifest.id || value.manifestDigest !== contentDigest(manifest) || !value.evidencePolicyRevision.trim()) throw new Error('manifest candidate identity or evidence is invalid')
  if (manifest.source.signature.status !== 'verified' || manifest.source.sbom.format === 'none' || !manifest.source.sbom.digest) throw new Error('manifest candidate lacks verified supply-chain evidence')
  return deepFreeze(structuredClone({ ...value, manifest }))
}

function validateEvidence(candidate: ManifestPublicationCandidateV1, evidence: ArtifactVerificationReportV1): void {
  const manifest = candidate.manifest
  if (evidence.schemaVersion !== 1 || evidence.decision !== 'verified' || evidence.capabilityId !== manifest.id || evidence.version !== manifest.version ||
      evidence.artifactDigest !== manifest.source.artifactDigest || evidence.sourceRevision !== manifest.source.revision || evidence.policyRevision !== candidate.evidencePolicyRevision ||
      requiredChecks.some(check => evidence.checks[check] !== 'pass') || Number.isNaN(Date.parse(evidence.evaluatedAt))) throw new Error('artifact evidence does not authorize inactive registration')
}

function recordFromRow(row: Row): CapabilityCatalogRecordV1 {
  const manifest = validateCapabilityManifest(JSON.parse(String(row.manifest_json)))
  const manifestDigest = String(row.manifest_digest)
  if (!digestPattern.test(manifestDigest) || manifestDigest !== contentDigest(manifest) || manifest.source.artifactDigest !== row.artifact_digest) throw new Error('persisted capability release integrity is invalid')
  return freezeRecord({ tenantId: String(row.tenant_id), ownerUserId: String(row.owner_user_id), manifest, manifestDigest,
    evidencePolicyRevision: String(row.evidence_policy_revision), visibility: String(row.visibility) as CapabilityCatalogRecordV1['visibility'],
    state: 'catalogued-inactive', registeredAt: String(row.registered_at), consumerCount: 0, providerLease: null,
    schedulerCount: 0, externalWritesEnabled: false })
}

function visible(record: CapabilityCatalogRecordV1, context: TenantContextV1): boolean { return record.visibility === 'tenant' || record.ownerUserId === context.userId }
function validateContext(context: TenantContextV1): void {
  if (!context.tenantId.startsWith('test.')) throw new Error('inactive Capability Registry accepts test tenants only')
  validId(context.tenantId, 'tenantId'); validId(context.userId, 'userId')
  if (!context.roles.length || new Set(context.roles).size !== context.roles.length || context.roles.some(role => !['owner', 'member', 'auditor'].includes(role))) throw new Error('tenant roles are invalid')
}
function validId(value: string, label: string): void { if (!idPattern.test(value)) throw new Error(`${label} is invalid`) }
function validVersion(value: string): void { if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) throw new Error('capability version is invalid') }
function validNow(now: Date): string { if (Number.isNaN(now.getTime())) throw new Error('timestamp is invalid'); return now.toISOString() }
function freezeRecord(value: CapabilityCatalogRecordV1): CapabilityCatalogRecordV1 { return deepFreeze(structuredClone(value)) }
function undefinedNever(): never { throw new Error('private capability release owner differs from caller') }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }
