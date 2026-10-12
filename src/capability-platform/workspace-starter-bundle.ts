import { createHash } from 'node:crypto'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_FILES = 64
const MAX_FILE_BYTES = 128 * 1024
const DIGEST = /^sha256:[a-f0-9]{64}$/
const REVISION = /^[a-f0-9]{40}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'workspace.json', 'docs/INDEX.md', 'skills/workspace-router/SKILL.md'])

export interface WorkspaceStarterBundlePinV1 { readonly sourceRevision: string; readonly artifactDigest: string }
export interface WorkspaceStarterBundleViewV1 {
  readonly schemaVersion: 1
  readonly bundleId: 'agent-workspace-starter'
  readonly bundleVersion: string
  readonly profile: 'developer' | 'product'
  readonly sourceRevision: string
  readonly artifactDigest: string
  readonly fileCount: number
  readonly state: 'inactive'
  readonly executable: false
  readonly externalWritesEnabled: false
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${label} has unexpected fields`)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('bundle contains a non-JSON value')
  return encoded
}

function sha256(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function allowedPath(path: unknown, profile: string): path is string {
  if (typeof path !== 'string') return false
  if (ROOT_FILES.has(path) || path === '.gitignore' || path === 'private/README.md' || path === `packs/${profile}/route.md`) return true
  return /^docs\/(?:[a-z0-9-]+\/)*[A-Za-z0-9-]+\.md$/.test(path)
}

/** Integrity-only, read-only intake. The caller must supply a trusted exact revision and digest. */
export function inspectWorkspaceStarterBundleBytes(raw: Uint8Array, pin: WorkspaceStarterBundlePinV1): WorkspaceStarterBundleViewV1 {
  if (!(raw instanceof Uint8Array) || raw.byteLength < 1 || raw.byteLength > MAX_BYTES) throw new Error('workspace starter bundle size is invalid')
  if (!REVISION.test(pin.sourceRevision) || !DIGEST.test(pin.artifactDigest)) throw new Error('workspace starter bundle pin is invalid')
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(raw).toString('utf8')) } catch { throw new Error('workspace starter bundle JSON is invalid') }
  const bundle = object(parsed, 'workspace starter bundle')
  const canonicalBytes = Buffer.from(`${canonical(bundle)}\n`, 'utf8')
  if (!Buffer.from(raw).equals(canonicalBytes)) throw new Error('workspace starter bundle is not canonical')
  exactKeys(bundle, ['schema_version', 'bundle_id', 'bundle_version', 'profile', 'source_revision', 'core_channel', 'state', 'external_writes_enabled', 'files', 'artifact_digest'], 'workspace starter bundle')
  if (bundle.schema_version !== 1 || bundle.bundle_id !== 'agent-workspace-starter' || typeof bundle.bundle_version !== 'string' || !VERSION.test(bundle.bundle_version)) throw new Error('workspace starter bundle schema is invalid')
  if (bundle.profile !== 'developer' && bundle.profile !== 'product') throw new Error('workspace starter bundle profile is invalid')
  if (bundle.source_revision !== pin.sourceRevision || bundle.artifact_digest !== pin.artifactDigest) throw new Error('workspace starter bundle does not match its pin')
  const channel = object(bundle.core_channel, 'workspace starter channel')
  exactKeys(channel, ['adapter', 'id', 'required'], 'workspace starter channel')
  if (channel.id !== 'feishu' || channel.adapter !== 'lark-cli' || channel.required !== true || bundle.state !== 'inactive' || bundle.external_writes_enabled !== false) throw new Error('workspace starter bundle activation boundary is invalid')
  if (!Array.isArray(bundle.files) || bundle.files.length < 1 || bundle.files.length > MAX_FILES) throw new Error('workspace starter bundle inventory is invalid')

  const files = new Map<string, Buffer>()
  const foldedPaths = new Set<string>()
  const inventory: Array<{ path: string; size: number; digest: string }> = []
  let prior = ''
  for (const item of bundle.files) {
    const file = object(item, 'workspace starter file')
    exactKeys(file, ['path', 'size', 'digest', 'content_base64'], 'workspace starter file')
    if (!allowedPath(file.path, bundle.profile) || (prior && file.path <= prior)) throw new Error('workspace starter file path is invalid')
    const folded = file.path.toLowerCase()
    if (foldedPaths.has(folded)) throw new Error('workspace starter case-insensitive path collision')
    foldedPaths.add(folded)
    if (!Number.isSafeInteger(file.size) || Number(file.size) < 0 || Number(file.size) > MAX_FILE_BYTES || typeof file.digest !== 'string' || !DIGEST.test(file.digest) || typeof file.content_base64 !== 'string') throw new Error('workspace starter file metadata is invalid')
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content_base64)) throw new Error('workspace starter file encoding is invalid')
    const content = Buffer.from(file.content_base64, 'base64')
    if (content.toString('base64') !== file.content_base64 || content.byteLength !== file.size || sha256(content) !== file.digest) throw new Error('workspace starter file failed integrity verification')
    files.set(file.path, content)
    inventory.push({ path: file.path, size: file.size as number, digest: file.digest })
    prior = file.path
  }
  for (const required of ROOT_FILES) if (!files.has(required)) throw new Error('workspace starter bundle is missing a required entry')
  const unsigned: Record<string, unknown> = { ...bundle, files: inventory }
  delete unsigned.artifact_digest
  if (sha256(Buffer.from(`${canonical(unsigned)}\n`, 'utf8')) !== bundle.artifact_digest) throw new Error('workspace starter bundle digest drifted')

  let config: unknown
  try { config = JSON.parse(files.get('workspace.json')!.toString('utf8')) } catch { throw new Error('workspace starter config is invalid') }
  const workspace = object(config, 'workspace starter config')
  const workspaceChannel = object(workspace.core_channel, 'workspace starter config channel')
  if (workspace.schema_version !== 1 || workspace.profile !== bundle.profile || workspaceChannel.id !== 'feishu' || workspaceChannel.adapter !== 'lark-cli' || workspaceChannel.required !== true || workspaceChannel.readiness_owner !== 'host-runtime') throw new Error('workspace starter config contract drifted')
  const permissions = object(workspace.permissions, 'workspace starter permissions')
  if (permissions.external_writes !== 'confirm-each' || permissions.network !== 'disabled-by-default') throw new Error('workspace starter permissions drifted')
  if (!Array.isArray(workspace.sources) || workspace.sources.some(source => { const entry = object(source, 'workspace starter source'); return typeof entry.path !== 'string' || !files.has(entry.path) })) throw new Error('workspace starter source is missing')
  return Object.freeze({ schemaVersion: 1, bundleId: 'agent-workspace-starter', bundleVersion: bundle.bundle_version, profile: bundle.profile,
    sourceRevision: pin.sourceRevision, artifactDigest: pin.artifactDigest, fileCount: files.size, state: 'inactive', executable: false, externalWritesEnabled: false })
}
