import { createHash } from 'node:crypto'
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const digestPattern = /^sha256:[a-f0-9]{64}$/
const revisionPattern = /^[a-f0-9]{40}$/
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/

export interface ClientDistributionFileV1 { readonly path: string; readonly size: number; readonly digest: string }
export interface ClientDistributionManifestV1 {
  readonly schemaVersion: 1
  readonly clientVersion: string
  readonly sourceRevision: string
  readonly entrypoint: 'program/dist/client-runtime/client-entry.js'
  readonly sbomPath: 'program/sbom.spdx.json'
  readonly files: readonly ClientDistributionFileV1[]
  readonly artifactDigest: string
  readonly autoStart: false
  readonly externalWritesEnabled: false
}

/** Seals a preassembled client directory. The manifest is content-addressed and contains no host paths. */
export async function sealClientDistribution(root: string, clientVersion: string, sourceRevision: string): Promise<ClientDistributionManifestV1> {
  const canonical = await privateCanonicalDirectory(root)
  if (!versionPattern.test(clientVersion) || !revisionPattern.test(sourceRevision)) throw new Error('client distribution identity is invalid')
  if ((await readdir(canonical)).includes('client-distribution.json')) throw new Error('client distribution is already sealed')
  const files = await inventory(canonical)
  requireFiles(files)
  const unsigned = { schemaVersion: 1 as const, clientVersion, sourceRevision, entrypoint: 'program/dist/client-runtime/client-entry.js' as const, sbomPath: 'program/sbom.spdx.json' as const, files, autoStart: false as const, externalWritesEnabled: false as const }
  const manifest = Object.freeze({ ...unsigned, artifactDigest: digest(Buffer.from(JSON.stringify(unsigned), 'utf8')) })
  const handle = await open(resolve(canonical, 'client-distribution.json'), 'wx', 0o600)
  try { await handle.writeFile(`${JSON.stringify(manifest)}\n`); await handle.sync() } finally { await handle.close() }
  return manifest
}

/** Recomputes every byte before installation; unknown, missing, linked or world-readable files fail closed. */
export async function verifyClientDistribution(root: string): Promise<ClientDistributionManifestV1> {
  const canonical = await privateCanonicalDirectory(root)
  const top = (await readdir(canonical)).sort().join(',')
  if (!['client-distribution.json,program', 'client-distribution.json,program,runtime,state', 'client-distribution.json,client.json,install-receipt.json,program,runtime,state'].includes(top)) throw new Error('client distribution layout is invalid')
  const manifestBytes = await boundedPrivateFile(resolve(canonical, 'client-distribution.json'), 16 * 1024 * 1024)
  let parsed: unknown
  try { parsed = JSON.parse(manifestBytes.toString('utf8')) } catch { throw new Error('client distribution manifest is invalid') }
  const manifest = exactManifest(parsed)
  const actualFiles = await inventory(canonical)
  if (JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)) throw new Error('client distribution inventory drifted')
  requireFiles(actualFiles)
  const { artifactDigest, ...unsigned } = manifest
  if (digest(Buffer.from(JSON.stringify(unsigned), 'utf8')) !== artifactDigest) throw new Error('client distribution digest drifted')
  return manifest
}

async function inventory(root: string): Promise<readonly ClientDistributionFileV1[]> {
  const output: ClientDistributionFileV1[] = []
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      if (directory === root && name === 'client-distribution.json') continue
      const path = resolve(directory, name); const status = await lstat(path)
      if (status.isSymbolicLink()) throw new Error('client distribution cannot contain links')
      if (status.isDirectory()) { if ((status.mode & 0o077) !== 0) throw new Error('client distribution directory must be private'); await visit(path); continue }
      if (!status.isFile() || (status.mode & 0o077) !== 0 || status.size < 0 || status.size > 64 * 1024 * 1024) throw new Error('client distribution file is unsafe')
      const bytes = await readFile(path)
      output.push(Object.freeze({ path: portable(root, path), size: bytes.byteLength, digest: digest(bytes) }))
    }
  }
  await visit(resolve(root, 'program'))
  return Object.freeze(output.sort((left, right) => left.path.localeCompare(right.path)))
}

function requireFiles(files: readonly ClientDistributionFileV1[]): void {
  const paths = new Set(files.map(file => file.path))
  for (const required of ['program/dist/client-runtime/client-entry.js', 'program/dist/client-runtime/client-installer-entry.js', 'program/dist/client-runtime/dsh-stdin-host.js', 'program/package.json', 'program/config/dsh-baseline.json', 'program/config/dsh-inference-provider.patch.yml', 'program/config/dsh-reasoning-only.patch.yml', 'program/migrations/client-sqlite/001_client_state.sql', 'program/sbom.spdx.json']) if (!paths.has(required) || files.find(file => file.path === required)!.size === 0) throw new Error(`client distribution is incomplete: ${required}`)
}

function exactManifest(value: unknown): ClientDistributionManifestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client distribution manifest is invalid')
  const item = value as Record<string, unknown>; const keys = ['schemaVersion', 'clientVersion', 'sourceRevision', 'entrypoint', 'sbomPath', 'files', 'artifactDigest', 'autoStart', 'externalWritesEnabled']
  if (Object.keys(item).sort().join(',') !== keys.sort().join(',') || item.schemaVersion !== 1 || typeof item.clientVersion !== 'string' || !versionPattern.test(item.clientVersion) || typeof item.sourceRevision !== 'string' || !revisionPattern.test(item.sourceRevision) || item.entrypoint !== 'program/dist/client-runtime/client-entry.js' || item.sbomPath !== 'program/sbom.spdx.json' || typeof item.artifactDigest !== 'string' || !digestPattern.test(item.artifactDigest) || item.autoStart !== false || item.externalWritesEnabled !== false || !Array.isArray(item.files)) throw new Error('client distribution manifest is invalid')
  let prior = ''
  for (const file of item.files as unknown[]) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('client distribution file record is invalid')
    const entry = file as Record<string, unknown>
    if (Object.keys(entry).sort().join(',') !== ['digest', 'path', 'size'].sort().join(',') || typeof entry.path !== 'string' || !safeRelative(entry.path) || (prior && entry.path.localeCompare(prior) <= 0) || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.digest !== 'string' || !digestPattern.test(entry.digest)) throw new Error('client distribution file record is invalid')
    prior = entry.path
  }
  return Object.freeze(item as unknown as ClientDistributionManifestV1)
}

async function privateCanonicalDirectory(value: string): Promise<string> { if (!isAbsolute(value) || resolve(value) !== value || value === '/' || await realpath(value) !== value) throw new Error('client distribution root must be canonical'); const state = await lstat(value); if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0) throw new Error('client distribution root must be private'); return value }
async function boundedPrivateFile(path: string, max: number): Promise<Buffer> { const state = await lstat(path); if (!state.isFile() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || state.size <= 0 || state.size > max) throw new Error('client distribution manifest is unsafe'); return await readFile(path) }
function portable(root: string, path: string): string { const value = relative(root, path).split(sep).join('/'); if (!safeRelative(value)) throw new Error('client distribution path is unsafe'); return value }
function safeRelative(value: string): boolean { return Boolean(value) && !value.startsWith('/') && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..') }
function digest(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
