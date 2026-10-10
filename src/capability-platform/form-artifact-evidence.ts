import { createHash, createPublicKey, verify } from 'node:crypto'
import type { CapabilityManifestV1 } from './manifest.js'
import { canonicalJson, contentDigest, validateCapabilityManifest } from './validation.js'

const digestPattern = /^sha256:[a-f0-9]{64}$/
const revisionPattern = /^[a-f0-9]{40}$/
type PublicForm = 'tool' | 'package' | 'headless-browser' | 'interactive-application'
const expectedForms = new Map([
  ['tool', { id: 'network-recovery', kind: 'cli', moduleId: 'network-recovery-adapter' }],
  ['package', { id: 'postgres-storage', kind: 'package', moduleId: 'postgres-storage' }],
  ['headless-browser', { id: 'headless-browser-runtime', kind: 'browser-runtime', moduleId: 'headless-browser-runtime' }],
  ['interactive-application', { id: 'control-console', kind: 'application', moduleId: 'control-console' }],
] as const)

export interface PublicCapabilityFormArtifactV1 {
  readonly form: string
  readonly moduleId: string
  readonly files: readonly { readonly path: string; readonly digest: string }[]
  readonly artifactBundleDigest: string
  readonly sbom: Record<string, unknown>
  readonly manifest: CapabilityManifestV1
  readonly signatureBase64: string
  readonly lifecycleRehearsal: {
    readonly status: 'pending' | 'verified-inactive'
    readonly install: boolean
    readonly recover: boolean
    readonly uninstall: boolean
    readonly loading: 'unloaded'
    readonly authorization: 'unauthorized'
    readonly execution: 'stopped'
    readonly effects: 'disabled'
  }
  readonly publicationAllowed: false
  readonly activationAllowed: false
}

export interface PublicCapabilityFormArtifactsV1 {
  readonly schemaVersion: 1
  readonly status: 'validated-unpublished-inactive'
  readonly sourceRevision: string
  readonly signature: {
    readonly algorithm: 'ed25519'
    readonly keyId: string
    readonly publicKeySpkiBase64: string
    readonly privateKeyPersisted: false
  }
  readonly artifacts: readonly PublicCapabilityFormArtifactV1[]
  readonly activationAllowed: false
  readonly externalWritesEnabled: false
}

/** Verifies portable first-party form evidence without loading or executing any artifact. */
export function validatePublicCapabilityFormArtifacts(input: unknown): PublicCapabilityFormArtifactsV1 {
  const document = object(input, 'public capability form evidence')
  exactKeys(document, ['schemaVersion', 'status', 'sourceRevision', 'signature', 'artifacts', 'activationAllowed', 'externalWritesEnabled'], 'public capability form evidence')
  if (document.schemaVersion !== 1 || document.status !== 'validated-unpublished-inactive' || document.activationAllowed !== false || document.externalWritesEnabled !== false) throw new Error('public capability form evidence must remain unpublished and inactive')
  const revision = string(document.sourceRevision, 'sourceRevision')
  if (!revisionPattern.test(revision)) throw new Error('public capability form source revision is invalid')
  const signature = object(document.signature, 'signature')
  exactKeys(signature, ['algorithm', 'keyId', 'publicKeySpkiBase64', 'privateKeyPersisted'], 'signature')
  if (signature.algorithm !== 'ed25519' || signature.privateKeyPersisted !== false) throw new Error('public capability form signing policy is invalid')
  const keyId = digest(signature.keyId, 'signature.keyId')
  const publicDer = decodeBase64(string(signature.publicKeySpkiBase64, 'signature.publicKeySpkiBase64'), 'signature public key')
  if (sha256(publicDer) !== keyId) throw new Error('public capability form signing key id does not match the public key')
  const publicKey = createPublicKey({ key: publicDer, format: 'der', type: 'spki' })
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('public capability form signing key is not Ed25519')

  if (!Array.isArray(document.artifacts) || document.artifacts.length !== expectedForms.size) throw new Error('public capability form evidence must contain every public form exactly once')
  const seen = new Set<string>()
  const artifacts = document.artifacts.map((inputArtifact, index) => {
    const artifact = object(inputArtifact, `artifacts[${index}]`)
    exactKeys(artifact, ['form', 'moduleId', 'files', 'artifactBundleDigest', 'sbom', 'manifest', 'signatureBase64', 'lifecycleRehearsal', 'publicationAllowed', 'activationAllowed'], `artifacts[${index}]`)
    const form = string(artifact.form, `artifacts[${index}].form`)
    const expected = expectedForms.get(form as PublicForm)
    if (!expected || seen.has(form)) throw new Error('public capability form identity is missing or duplicated')
    seen.add(form)
    if (artifact.moduleId !== expected.moduleId || artifact.publicationAllowed !== false || artifact.activationAllowed !== false) throw new Error(`public capability form ${form} identity or inactive gates are invalid`)
    if (!Array.isArray(artifact.files) || artifact.files.length === 0) throw new Error(`public capability form ${form} has no source files`)
    const files = artifact.files.map((fileInput, fileIndex) => {
      const file = object(fileInput, `artifacts[${index}].files[${fileIndex}]`)
      exactKeys(file, ['path', 'digest'], `artifacts[${index}].files[${fileIndex}]`)
      const path = string(file.path, `artifacts[${index}].files[${fileIndex}].path`)
      if (path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error(`public capability form ${form} source path is not portable`)
      return Object.freeze({ path, digest: digest(file.digest, `artifacts[${index}].files[${fileIndex}].digest`) })
    })
    if (new Set(files.map(file => file.path)).size !== files.length || files.map(file => file.path).join('\0') !== [...files].sort((left, right) => left.path.localeCompare(right.path)).map(file => file.path).join('\0')) throw new Error(`public capability form ${form} source files must be unique and sorted`)
    const artifactBundleDigest = digest(artifact.artifactBundleDigest, `artifacts[${index}].artifactBundleDigest`)
    if (contentDigest({ revision, files }) !== artifactBundleDigest) throw new Error(`public capability form ${form} artifact bundle digest is invalid`)
    const sbom = object(artifact.sbom, `artifacts[${index}].sbom`)
    if (sbom.spdxVersion !== 'SPDX-2.3' || sbom.dataLicense !== 'CC0-1.0') throw new Error(`public capability form ${form} SBOM is invalid`)
    const sbomDigest = sha256(Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`))
    const manifest = validateCapabilityManifest(artifact.manifest)
    if (manifest.id !== expected.id || manifest.kind !== expected.kind || manifest.source.revision !== revision || manifest.source.artifactDigest !== artifactBundleDigest || manifest.source.signature.status !== 'verified' || manifest.source.signature.keyId !== keyId || manifest.source.sbom.format !== 'spdx' || manifest.source.sbom.digest !== sbomDigest) throw new Error(`public capability form ${form} manifest evidence is inconsistent`)
    const payload = Buffer.from(['quark-capability-signature-v1', revision, artifactBundleDigest, sbomDigest].join('\0'))
    if (!verify(null, payload, publicKey, decodeBase64(string(artifact.signatureBase64, `artifacts[${index}].signatureBase64`), 'artifact signature'))) throw new Error(`public capability form ${form} signature is invalid`)
    const rehearsal = object(artifact.lifecycleRehearsal, `artifacts[${index}].lifecycleRehearsal`)
    exactKeys(rehearsal, ['status', 'install', 'recover', 'uninstall', 'loading', 'authorization', 'execution', 'effects'], `artifacts[${index}].lifecycleRehearsal`)
    if (!['pending', 'verified-inactive'].includes(String(rehearsal.status)) || typeof rehearsal.install !== 'boolean' || typeof rehearsal.recover !== 'boolean' || typeof rehearsal.uninstall !== 'boolean' || rehearsal.loading !== 'unloaded' || rehearsal.authorization !== 'unauthorized' || rehearsal.execution !== 'stopped' || rehearsal.effects !== 'disabled') throw new Error(`public capability form ${form} lifecycle evidence is invalid`)
    if (rehearsal.status === 'pending' && (rehearsal.install || rehearsal.recover || rehearsal.uninstall)) throw new Error(`public capability form ${form} pending lifecycle evidence overclaims completion`)
    if (rehearsal.status === 'verified-inactive' && (!rehearsal.install || !rehearsal.recover || !rehearsal.uninstall)) throw new Error(`public capability form ${form} verified lifecycle evidence is incomplete`)
    const lifecycleRehearsal: PublicCapabilityFormArtifactV1['lifecycleRehearsal'] = Object.freeze({ status: rehearsal.status as 'pending' | 'verified-inactive', install: rehearsal.install,
      recover: rehearsal.recover, uninstall: rehearsal.uninstall, loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled' })
    return Object.freeze({ form, moduleId: expected.moduleId, files, artifactBundleDigest, sbom, manifest, signatureBase64: String(artifact.signatureBase64), lifecycleRehearsal, publicationAllowed: false as const, activationAllowed: false as const })
  })
  return Object.freeze({ schemaVersion: 1, status: 'validated-unpublished-inactive', sourceRevision: revision,
    signature: Object.freeze({ algorithm: 'ed25519', keyId, publicKeySpkiBase64: String(signature.publicKeySpkiBase64), privateKeyPersisted: false }),
    artifacts: Object.freeze(artifacts), activationAllowed: false, externalWritesEnabled: false })
}

export function publicCapabilityArtifactBytes(document: PublicCapabilityFormArtifactsV1, artifact: PublicCapabilityFormArtifactV1): Buffer {
  return Buffer.from(canonicalJson({ revision: document.sourceRevision, files: artifact.files }))
}

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown> }
function string(value: unknown, label: string): string { if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`); return value }
function digest(value: unknown, label: string): string { const result = string(value, label); if (!digestPattern.test(result)) throw new Error(`${label} must be a sha256 digest`); return result }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void { const unknown = Object.keys(value).filter(key => !allowed.includes(key)); if (unknown.length) throw new Error(`${label} has unknown fields: ${unknown.join(',')}`) }
function decodeBase64(value: string, label: string): Buffer { const result = Buffer.from(value, 'base64'); if (!result.length || result.toString('base64') !== value) throw new Error(`${label} is invalid base64`); return result }
function sha256(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
