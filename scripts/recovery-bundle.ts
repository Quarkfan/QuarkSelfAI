import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  expandSelector,
  isRequired,
  readRuntimeEnvironment,
  type RecoveryContext,
} from './audit-recovery-readiness.js'

const execFile = promisify(execFileCallback)
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_COMMAND_OUTPUT = 4 * 1024 * 1024
const AGE_HEADER = 'age-encryption.org/v1\n'

type RequiredWhen = 'always' | 'sqlite' | 'postgres' | 'compatibility' | 'optional'
type SelectorKind = 'path' | 'environment'

type ArtifactSpec = {
  id: string
  class: string
  selector: string
  selectorKind?: SelectorKind
  requiredWhen: RequiredWhen
  backupMethod: string
  sensitivity: string
  restoreOrder: number
}

type RecoveryManifest = {
  schemaVersion: number
  projectId: string
  artifacts: ArtifactSpec[]
}

type BundleEntry = {
  artifactId: string
  path: string
  bytes: number
  mode: string
  sha256: string
}

type BundleDocument = {
  bundleFormatVersion: 1
  projectId: string
  bundleId: string
  createdAt: string
  captureStartedAt: string
  captureCompletedAt: string
  captureMode: 'online-bounded' | 'quiesced'
  gitRevision: string
  storage: string
  applicationMode: string
  entries: BundleEntry[]
  excludedOptionalArtifacts: string[]
}

export type RecoveryBinaries = {
  sqlite3: string
  pgDump: string
  pgRestore: string
  psql: string
  tar: string
  age: string
}

export type CreateBundleOptions = {
  projectRoot: string
  home: string
  environment: Record<string, string | undefined>
  output: string
  recipient: string
  includeOptional?: boolean
  quiesced?: boolean
  binaries?: Partial<RecoveryBinaries>
}

export type StageBundleOptions = {
  input: string
  outputDirectory: string
  identityFile: string
  binaries?: Partial<RecoveryBinaries>
}

export type PrepareRestoreSafeOptions = {
  stagingDirectory: string
  projectRoot: string
  webPort?: number
  binaries?: Pick<Partial<RecoveryBinaries>, 'sqlite3'>
}

export type PreparePostgresRestoreSafeOptions = {
  stagingDirectory: string
  projectRoot: string
  databaseUrl: string
  approvedBundleId: string
  webPort?: number
  environment?: NodeJS.ProcessEnv
  binaries?: Pick<Partial<RecoveryBinaries>, 'pgRestore' | 'psql' | 'sqlite3'>
}

export type RestoreSafeReceipt = {
  mode: 'restore-safe'
  bundleId: string
  gitRevision: string
  preparedAt: string
  runtimeEnvironment: string
  pendingGates: string[]
}

type PostgresSnapshotMetadata = {
  formatVersion: 1
  serverVersionNum: string
  migrations: string[]
}

const defaultBinaries: RecoveryBinaries = {
  sqlite3: 'sqlite3',
  pgDump: 'pg_dump',
  pgRestore: 'pg_restore',
  psql: 'psql',
  tar: 'tar',
  age: 'age',
}

function assertSafeId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error(`${label} is not a safe identifier`)
}

function assertRecipient(recipient: string): void {
  if (!recipient.startsWith('age1') && !recipient.startsWith('age-plugin-')) {
    throw new Error('recipient must be an age/X25519 or age plugin public recipient')
  }
}

function safeRelativePath(value: string): boolean {
  if (!value || isAbsolute(value)) return false
  const parts = value.split(/[\\/]+/)
  return parts.every(part => part !== '..' && part !== '')
}

function sqliteQuoted(path: string): string {
  return `"${path.replaceAll('"', '""')}"`
}

function sqliteImmutableUri(path: string): string {
  return `file:${encodeURI(resolve(path))}?immutable=1`
}

async function run(binary: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  try {
    return await execFile(binary, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      maxBuffer: MAX_COMMAND_OUTPUT,
    })
  } catch {
    throw new Error(`${basename(binary)} failed`)
  }
}

function postgresEnvironment(connectionString: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('PostgreSQL restore connection is not a valid URL')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('PostgreSQL restore connection must use postgres:// or postgresql://')
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const user = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  if (!url.hostname || !user || !database || database.includes('/')
    || [url.hostname, user, password, database].some(value => /[\r\n\0]/.test(value))) {
    throw new Error('PostgreSQL restore connection must include host, user, and one database name')
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...base,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: database,
  }
  const allowedParameters: Readonly<Record<string, string>> = {
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    sslcrl: 'PGSSLCRL',
  }
  const seenParameters = new Set<string>()
  for (const [name, value] of url.searchParams) {
    const target = allowedParameters[name]
    if (!target) throw new Error(`unsupported PostgreSQL connection parameter: ${name}`)
    if (seenParameters.has(name) || /[\r\n\0]/.test(value)) throw new Error(`invalid PostgreSQL connection parameter: ${name}`)
    seenParameters.add(name)
    environment[target] = value
  }
  delete environment.DATABASE_URL
  delete environment.QUARK_RESTORE_POSTGRES_URL
  return environment
}

async function postgresQuery(binary: string, sql: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const result = await run(binary, [
    '-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', sql,
  ], { env: environment })
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function postgresMajor(version: string): number {
  if (!/^\d{5,6}$/.test(version)) throw new Error('PostgreSQL server version is invalid')
  return Math.floor(Number(version) / 10_000)
}

function parsePostgresMetadata(value: unknown): PostgresSnapshotMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PostgreSQL snapshot metadata is invalid')
  const metadata = value as Partial<PostgresSnapshotMetadata>
  if (metadata.formatVersion !== 1 || typeof metadata.serverVersionNum !== 'string'
    || !Array.isArray(metadata.migrations) || metadata.migrations.some(item => typeof item !== 'string')) {
    throw new Error('PostgreSQL snapshot metadata is invalid')
  }
  postgresMajor(metadata.serverVersionNum)
  const migrations = [...metadata.migrations]
  if (migrations.length === 0 || new Set(migrations).size !== migrations.length
    || migrations.some(item => !/^\d{3}_[a-z0-9_]+\.sql$/.test(item))) {
    throw new Error('PostgreSQL snapshot migration list is invalid')
  }
  return { formatVersion: 1, serverVersionNum: metadata.serverVersionNum, migrations }
}

async function gitRevision(root: string): Promise<string> {
  const result = await run('git', ['rev-parse', 'HEAD'], { cwd: root })
  return result.stdout.trim()
}

async function sha256(path: string): Promise<string> {
  const content = await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

async function assertAgeFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(Buffer.byteLength(AGE_HEADER))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== buffer.length || buffer.toString('utf8') !== AGE_HEADER) {
      throw new Error('age did not produce a valid encrypted file')
    }
  } finally {
    await handle.close()
  }
}

async function copyRegularFile(source: string, destination: string): Promise<void> {
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('recovery source must be a regular file')
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await copyFile(source, destination)
  await chmod(destination, sourceInfo.mode & 0o777)
}

function excludedRuntimeFile(name: string): boolean {
  return name === '.DS_Store'
    || name === 'node_modules'
    || name.endsWith('-wal')
    || name.endsWith('-shm')
    || name.endsWith('.lock')
    || name.endsWith('.log')
    || name.endsWith('.tmp')
}

async function snapshotSqlite(source: string, destination: string, binary: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await run(binary, [source, `.backup ${sqliteQuoted(destination)}`])
  const check = await run(binary, [sqliteImmutableUri(destination), 'PRAGMA integrity_check;'])
  if (check.stdout.trim() !== 'ok') throw new Error('SQLite snapshot integrity check failed')
  await chmod(destination, 0o600)
}

async function snapshotTree(source: string, destination: string, binaries: RecoveryBinaries): Promise<void> {
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('recovery tree must be a regular directory')
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (excludedRuntimeFile(entry.name)) continue
    const childSource = join(source, entry.name)
    const childDestination = join(destination, entry.name)
    if (entry.isSymbolicLink()) throw new Error('recovery source tree contains a symbolic link')
    if (entry.isDirectory()) {
      await snapshotTree(childSource, childDestination, binaries)
    } else if (entry.isFile() && entry.name.endsWith('.sqlite3')) {
      await snapshotSqlite(childSource, childDestination, binaries.sqlite3)
    } else if (entry.isFile()) {
      await copyRegularFile(childSource, childDestination)
    }
  }
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = []
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) throw new Error('recovery staging contains a symbolic link')
    if (entry.isDirectory()) result.push(...await listFiles(root, path))
    else if (entry.isFile()) result.push(relative(root, path).split(sep).join('/'))
  }
  return result
}

async function collectEntries(bundleRoot: string): Promise<BundleEntry[]> {
  const files = (await listFiles(bundleRoot)).filter(path => path !== 'bundle.json')
  const entries: BundleEntry[] = []
  for (const path of files) {
    const fullPath = resolve(bundleRoot, path)
    const info = await stat(fullPath)
    const artifactId = path.split('/')[1]
    assertSafeId(artifactId, 'artifact id')
    entries.push({
      artifactId,
      path,
      bytes: info.size,
      mode: (info.mode & 0o777).toString(8).padStart(3, '0'),
      sha256: await sha256(fullPath),
    })
  }
  return entries
}

async function loadManifest(root: string): Promise<RecoveryManifest> {
  const value = JSON.parse(await readFile(resolve(root, 'config/recovery-manifest.json'), 'utf8')) as RecoveryManifest
  if (value.schemaVersion !== 1 || value.projectId !== 'quarkselfai' || !Array.isArray(value.artifacts)) {
    throw new Error('unsupported recovery manifest')
  }
  for (const artifact of value.artifacts) assertSafeId(artifact.id, 'artifact id')
  return value
}

async function snapshotArtifact(
  artifact: ArtifactSpec,
  source: string,
  destinationRoot: string,
  binaries: RecoveryBinaries,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const destination = resolve(destinationRoot, 'artifacts', artifact.id)
  if (artifact.backupMethod === 'sqlite-online-backup') {
    await snapshotSqlite(source, join(destination, 'database.sqlite3'), binaries.sqlite3)
    return
  }
  if (artifact.backupMethod === 'pg-dump-custom') {
    await mkdir(destination, { recursive: true, mode: 0o700 })
    const pgEnvironment = postgresEnvironment(source, environment)
    const serverVersion = await postgresQuery(binaries.psql, 'SHOW server_version_num;', pgEnvironment)
    const migrations = await postgresQuery(binaries.psql, 'SELECT version FROM schema_migration ORDER BY version;', pgEnvironment)
    if (serverVersion.length !== 1) throw new Error('PostgreSQL server version query returned an unexpected result')
    const metadata = parsePostgresMetadata({ formatVersion: 1, serverVersionNum: serverVersion[0], migrations })
    await run(binaries.pgDump, ['--format=custom', '--file', join(destination, 'database.dump')], {
      env: pgEnvironment,
    })
    const migrationsAfterDump = await postgresQuery(binaries.psql, 'SELECT version FROM schema_migration ORDER BY version;', pgEnvironment)
    if (JSON.stringify(migrationsAfterDump) !== JSON.stringify(metadata.migrations)) {
      throw new Error('PostgreSQL migration set changed while the snapshot was captured')
    }
    await chmod(join(destination, 'database.dump'), 0o600)
    await writeFile(join(destination, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
    return
  }
  if (artifact.backupMethod === 'filtered-archive' || artifact.backupMethod === 'curated-capability-pack') {
    await snapshotTree(source, destination, binaries)
    return
  }
  if (artifact.backupMethod === 'encrypted-file' || artifact.backupMethod === 'encrypted-file-or-reauthenticate') {
    const name = artifact.selectorKind === 'environment' ? 'value' : basename(source)
    const copied = join(destination, name)
    await copyRegularFile(source, copied)
    await chmod(copied, 0o600)
    return
  }
  throw new Error(`unsupported backup method for ${artifact.id}`)
}

export async function createRecoveryBundle(options: CreateBundleOptions): Promise<BundleDocument> {
  assertRecipient(options.recipient)
  const root = resolve(options.projectRoot)
  const output = resolve(options.output)
  if (!output.endsWith('.age')) throw new Error('encrypted recovery bundle output must end with .age')
  try {
    await lstat(output)
    throw new Error('encrypted recovery bundle output already exists')
  } catch (error) {
    if (error instanceof Error && error.message === 'encrypted recovery bundle output already exists') throw error
  }

  const manifest = await loadManifest(root)
  const binaries = { ...defaultBinaries, ...options.binaries }
  const environment = { ...options.environment }
  const runtime = {
    storage: environment.ASSISTANT_STORAGE || 'sqlite',
    mode: environment.QUARK_APPLICATION_MODE || environment.ASSISTANT_RUNTIME || 'compatibility',
  }
  const context: RecoveryContext = { projectRoot: root, home: resolve(options.home), environment }
  const captureStartedAt = new Date().toISOString()
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  const temporaryRoot = await mkdtemp(join(dirname(output), '.quark-recovery-'))
  await chmod(temporaryRoot, 0o700)
  const bundleRoot = join(temporaryRoot, 'bundle')
  const archivePath = join(temporaryRoot, 'bundle.tar.gz')
  await mkdir(bundleRoot, { recursive: true, mode: 0o700 })

  try {
    const excludedOptionalArtifacts: string[] = []
    const seenSources = new Set<string>()
    for (const artifact of [...manifest.artifacts].sort((left, right) => left.restoreOrder - right.restoreOrder)) {
      const required = isRequired(artifact.requiredWhen, runtime)
      if (!required && !(options.includeOptional && artifact.requiredWhen === 'optional')) {
        if (artifact.requiredWhen === 'optional') excludedOptionalArtifacts.push(artifact.id)
        continue
      }
      const source = expandSelector(artifact.selector, context)
      if (!source) {
        if (required) throw new Error(`required recovery artifact is not configured: ${artifact.id}`)
        continue
      }
      if (artifact.selectorKind !== 'environment') {
        const key = resolve(source)
        if (seenSources.has(key)) continue
        seenSources.add(key)
      }
      try {
        await lstat(source)
      } catch {
        if (artifact.selectorKind !== 'environment' && required) {
          throw new Error(`required recovery artifact is missing: ${artifact.id}`)
        }
        if (artifact.selectorKind !== 'environment') continue
      }
      try {
        await snapshotArtifact(artifact, source, bundleRoot, binaries, environment)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown snapshot failure'
        throw new Error(`recovery artifact snapshot failed (${artifact.id}): ${reason}`)
      }
    }

    const entries = await collectEntries(bundleRoot)
    const captureCompletedAt = new Date().toISOString()
    const unsigned = {
      bundleFormatVersion: 1 as const,
      projectId: manifest.projectId,
      createdAt: captureCompletedAt,
      captureStartedAt,
      captureCompletedAt,
      captureMode: options.quiesced ? 'quiesced' as const : 'online-bounded' as const,
      gitRevision: await gitRevision(root),
      storage: runtime.storage,
      applicationMode: runtime.mode,
      entries,
      excludedOptionalArtifacts,
    }
    const canonical = JSON.stringify(unsigned)
    const document: BundleDocument = {
      ...unsigned,
      bundleId: createHash('sha256').update(canonical).digest('hex'),
    }
    await writeFile(join(bundleRoot, 'bundle.json'), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    await run(binaries.tar, ['-czf', archivePath, '-C', temporaryRoot, 'bundle'])
    await run(binaries.age, ['-r', options.recipient, '-o', output, archivePath])
    await assertAgeFile(output)
    await chmod(output, 0o600)
    return document
  } catch (error) {
    await rm(output, { force: true })
    throw error
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function validateArchiveEntries(archivePath: string, tarBinary: string): Promise<void> {
  const result = await run(tarBinary, ['-tzf', archivePath])
  const verbose = await run(tarBinary, ['-tvzf', archivePath])
  const entries = result.stdout.split(/\r?\n/).filter(Boolean)
  const types = verbose.stdout.split(/\r?\n/).filter(Boolean).map(line => line[0])
  if (entries.length === 0) throw new Error('recovery archive is empty')
  if (types.length !== entries.length || types.some(type => type !== '-' && type !== 'd')) {
    throw new Error('recovery archive contains a link or unsupported entry type')
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    const normalized = entry.replace(/\/$/, '')
    if (normalized === 'bundle') continue
    if (!normalized.startsWith('bundle/') || !safeRelativePath(normalized)) {
      throw new Error('recovery archive contains an unsafe path')
    }
    if (seen.has(normalized)) throw new Error('recovery archive contains a duplicate path')
    seen.add(normalized)
  }
}

async function verifyStagedBundle(bundleRoot: string, sqliteBinary: string): Promise<BundleDocument> {
  const document = JSON.parse(await readFile(join(bundleRoot, 'bundle.json'), 'utf8')) as BundleDocument
  if (document.bundleFormatVersion !== 1 || document.projectId !== 'quarkselfai' || !Array.isArray(document.entries)) {
    throw new Error('unsupported recovery bundle')
  }
  const { bundleId, ...unsigned } = document
  const expectedBundleId = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')
  if (bundleId !== expectedBundleId) throw new Error('recovery bundle manifest identity mismatch')

  const expectedPaths = new Set<string>()
  for (const entry of document.entries) {
    assertSafeId(entry.artifactId, 'artifact id')
    if (!safeRelativePath(entry.path) || !entry.path.startsWith(`artifacts/${entry.artifactId}/`)) {
      throw new Error('recovery bundle manifest contains an unsafe path')
    }
    if (expectedPaths.has(entry.path)) throw new Error('recovery bundle manifest contains a duplicate path')
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error('recovery bundle manifest contains invalid entry metadata')
    }
    expectedPaths.add(entry.path)
    const fullPath = resolve(bundleRoot, entry.path)
    if (relative(bundleRoot, fullPath).startsWith('..')) throw new Error('recovery bundle path escapes staging')
    const info = await lstat(fullPath)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('recovery bundle entry is not a regular file')
    if (info.size !== entry.bytes || await sha256(fullPath) !== entry.sha256) {
      throw new Error(`recovery bundle entry checksum mismatch: ${entry.path}`)
    }
    if (entry.path.endsWith('.sqlite3')) {
      const check = await run(sqliteBinary, [sqliteImmutableUri(fullPath), 'PRAGMA integrity_check;'])
      if (check.stdout.trim() !== 'ok') throw new Error(`SQLite recovery entry failed integrity check: ${entry.path}`)
    }
  }
  const actualPaths = new Set((await listFiles(bundleRoot)).filter(path => path !== 'bundle.json'))
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some(path => !expectedPaths.has(path))) {
    throw new Error('recovery bundle contains unregistered files')
  }
  return document
}

async function copyArtifactEntry(
  stagingRoot: string,
  targetRoot: string,
  entry: BundleEntry,
  sensitive = false,
): Promise<void> {
  const source = resolve(stagingRoot, entry.path)
  const destination = resolve(targetRoot, entry.path.slice(`artifacts/${entry.artifactId}/`.length))
  if (relative(targetRoot, destination).startsWith('..')) throw new Error('restore target path escapes staging')
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await copyFile(source, destination)
  await chmod(destination, sensitive ? 0o600 : Number.parseInt(entry.mode, 8))
}

function safeEnvironmentLine(name: string, value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error(`unsafe restore environment value: ${name}`)
  return `${name}=${value}`
}

const restoreArtifactMappings = new Map<string, { destination: string; sensitive: boolean }>([
  ['dsh-production-profile', { destination: 'dsh', sensitive: true }],
  ['compatibility-state', { destination: 'handoff', sensitive: true }],
  ['capability-evolution-state', { destination: 'capability-evolution', sensitive: false }],
  ['runtime-environment', { destination: 'recovery-input/runtime-environment', sensitive: true }],
  ['compatibility-config', { destination: 'recovery-input/compatibility-config', sensitive: true }],
  ['lark-cli-profile', { destination: 'recovery-input/account-bootstrap/lark-cli-profile', sensitive: true }],
  ['dida-cli-profile', { destination: 'recovery-input/account-bootstrap/dida-cli-profile', sensitive: true }],
  ['codex-personal-rules', { destination: 'recovery-input/optional/codex-personal-rules', sensitive: true }],
  ['claude-personal-skills', { destination: 'recovery-input/optional/claude-personal-skills', sensitive: true }],
])

function groupBundleEntries(document: BundleDocument): Map<string, BundleEntry[]> {
  const grouped = new Map<string, BundleEntry[]>()
  for (const entry of document.entries) {
    const values = grouped.get(entry.artifactId) ?? []
    values.push(entry)
    grouped.set(entry.artifactId, values)
  }
  return grouped
}

async function copySupportingArtifacts(
  stagingRoot: string,
  targetVar: string,
  grouped: Map<string, BundleEntry[]>,
  primaryArtifactId: string,
): Promise<void> {
  for (const [artifactId, entries] of grouped) {
    if (artifactId === primaryArtifactId) continue
    const mapping = restoreArtifactMappings.get(artifactId)
    if (!mapping) throw new Error(`restore-safe does not recognize artifact: ${artifactId}`)
    for (const entry of entries) {
      await copyArtifactEntry(stagingRoot, join(targetVar, mapping.destination), entry, mapping.sensitive)
    }
  }
}

/**
 * Materialize a verified bundle into a fresh clone without activating any
 * consumer, account, kernel, or external effect. The target's var directory
 * must not exist, so this cannot overwrite an active installation.
 */
export async function prepareRestoreSafe(options: PrepareRestoreSafeOptions): Promise<RestoreSafeReceipt> {
  const stagingRoot = resolve(options.stagingDirectory)
  const targetProject = resolve(options.projectRoot)
  const targetVar = join(targetProject, 'var')
  const sqliteBinary = options.binaries?.sqlite3 ?? defaultBinaries.sqlite3
  const document = await verifyStagedBundle(stagingRoot, sqliteBinary)
  const targetRevision = await gitRevision(targetProject)
  if (targetRevision !== document.gitRevision) {
    throw new Error('fresh clone revision does not match the recovery bundle')
  }
  try {
    await lstat(targetVar)
    throw new Error('fresh clone var directory already exists')
  } catch (error) {
    if (error instanceof Error && error.message === 'fresh clone var directory already exists') throw error
  }
  if (document.storage !== 'sqlite') {
    throw new Error('restore-safe preparation for PostgreSQL requires the separate empty-database restore gate')
  }
  const port = options.webPort ?? 13210
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('restore-safe web port is invalid')

  const temporaryVar = await mkdtemp(join(targetProject, '.quark-restore-safe-'))
  await chmod(temporaryVar, 0o700)
  try {
    const grouped = groupBundleEntries(document)
    const primary = grouped.get('primary-sqlite') ?? []
    if (primary.length !== 1 || primary[0]?.path !== 'artifacts/primary-sqlite/database.sqlite3') {
      throw new Error('recovery bundle does not contain one canonical SQLite database')
    }
    await copyArtifactEntry(stagingRoot, temporaryVar, primary[0], true)
    await rename(join(temporaryVar, 'database.sqlite3'), join(temporaryVar, 'quarkselfai.sqlite3'))

    await copySupportingArtifacts(stagingRoot, temporaryVar, grouped, 'primary-sqlite')

    const environment = [
      '# Generated restore-safe configuration. Do not set TAKEOVER_CONFIRMED here.',
      safeEnvironmentLine('ASSISTANT_STORAGE', 'sqlite'),
      safeEnvironmentLine('SQLITE_PATH', join(targetVar, 'quarkselfai.sqlite3')),
      safeEnvironmentLine('ASSISTANT_EXECUTION_MODE', 'local'),
      safeEnvironmentLine('ASSISTANT_WORKSPACE_ROOTS', JSON.stringify([targetProject])),
      safeEnvironmentLine('ASSISTANT_KERNEL', 'off'),
      safeEnvironmentLine('ASSISTANT_RUNTIME', 'control-only'),
      safeEnvironmentLine('QUARK_APPLICATION_MODE', 'compatibility'),
      safeEnvironmentLine('TAKEOVER_CONFIRMED', 'false'),
      safeEnvironmentLine('WORK_JOURNAL_ENABLED', 'false'),
      safeEnvironmentLine('WEB_HOST', '127.0.0.1'),
      safeEnvironmentLine('WEB_PORT', String(port)),
      safeEnvironmentLine('CONSOLE_TOKEN', randomBytes(32).toString('base64url')),
      safeEnvironmentLine('CONTROL_PLANE_TOKEN', randomBytes(32).toString('base64url')),
      safeEnvironmentLine('DSH_HOME', join(targetVar, 'dsh')),
      '',
    ].join('\n')
    await writeFile(join(temporaryVar, 'restore-safe.env'), environment, { mode: 0o600 })

    const receipt: RestoreSafeReceipt = {
      mode: 'restore-safe',
      bundleId: document.bundleId,
      gitRevision: document.gitRevision,
      preparedAt: new Date().toISOString(),
      runtimeEnvironment: 'var/restore-safe.env',
      pendingGates: [
        'account-reauthentication-or-reviewed-import',
        'workspace-path-review',
        'read-only-runtime-verification',
        'old-instance-stopped',
        'owner-approved-single-writer-takeover',
      ],
    }
    await writeFile(join(temporaryVar, 'restore-safe-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryVar, targetVar)
    return receipt
  } catch (error) {
    await rm(temporaryVar, { recursive: true, force: true })
    throw error
  }
}

/**
 * Restore a verified PostgreSQL bundle into an already-created empty database.
 * The database URL is accepted only as an environment-derived value and is
 * converted to libpq environment variables so credentials never enter argv.
 */
export async function preparePostgresRestoreSafe(options: PreparePostgresRestoreSafeOptions): Promise<RestoreSafeReceipt> {
  const stagingRoot = resolve(options.stagingDirectory)
  const targetProject = resolve(options.projectRoot)
  const targetVar = join(targetProject, 'var')
  const binaries = { ...defaultBinaries, ...options.binaries }
  const document = await verifyStagedBundle(stagingRoot, binaries.sqlite3)
  if (document.storage !== 'postgres') throw new Error('recovery bundle is not a PostgreSQL snapshot')
  if (options.approvedBundleId !== document.bundleId) throw new Error('PostgreSQL restore approval does not match the bundle id')
  if (await gitRevision(targetProject) !== document.gitRevision) {
    throw new Error('fresh clone revision does not match the recovery bundle')
  }
  try {
    await lstat(targetVar)
    throw new Error('fresh clone var directory already exists')
  } catch (error) {
    if (error instanceof Error && error.message === 'fresh clone var directory already exists') throw error
  }

  const grouped = groupBundleEntries(document)
  const primary = grouped.get('primary-postgres') ?? []
  const dumpEntry = primary.find(entry => entry.path === 'artifacts/primary-postgres/database.dump')
  const metadataEntry = primary.find(entry => entry.path === 'artifacts/primary-postgres/metadata.json')
  if (primary.length !== 2 || !dumpEntry || !metadataEntry) {
    throw new Error('recovery bundle does not contain one canonical PostgreSQL dump and metadata pair')
  }
  const metadata = parsePostgresMetadata(JSON.parse(await readFile(resolve(stagingRoot, metadataEntry.path), 'utf8')))
  const repositoryMigrations = (await readdir(join(targetProject, 'migrations')))
    .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
  if (JSON.stringify(metadata.migrations) !== JSON.stringify(repositoryMigrations)) {
    throw new Error('PostgreSQL snapshot migrations do not match the recovery revision')
  }

  const pgEnvironment = postgresEnvironment(options.databaseUrl, options.environment)
  const targetVersion = await postgresQuery(binaries.psql, 'SHOW server_version_num;', pgEnvironment)
  if (targetVersion.length !== 1 || postgresMajor(targetVersion[0]) < postgresMajor(metadata.serverVersionNum)) {
    throw new Error('PostgreSQL restore target is older than the snapshot source')
  }
  const emptyCount = await postgresQuery(
    binaries.psql,
    `SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');`,
    pgEnvironment,
  )
  if (emptyCount.length !== 1 || emptyCount[0] !== '0') {
    throw new Error('PostgreSQL restore target is not an empty database')
  }
  const dumpPath = resolve(stagingRoot, dumpEntry.path)
  const listing = await run(binaries.pgRestore, ['--list', dumpPath])
  if (!listing.stdout.trim()) throw new Error('PostgreSQL custom dump inventory is empty')

  const port = options.webPort ?? 13210
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('restore-safe web port is invalid')
  const temporaryVar = await mkdtemp(join(targetProject, '.quark-restore-safe-'))
  await chmod(temporaryVar, 0o700)
  let restoreStarted = false
  try {
    await copySupportingArtifacts(stagingRoot, temporaryVar, grouped, 'primary-postgres')
    const environment = [
      '# Generated PostgreSQL restore-safe configuration. Do not set TAKEOVER_CONFIRMED here.',
      safeEnvironmentLine('ASSISTANT_STORAGE', 'postgres'),
      safeEnvironmentLine('DATABASE_URL', options.databaseUrl),
      safeEnvironmentLine('ASSISTANT_EXECUTION_MODE', 'local'),
      safeEnvironmentLine('ASSISTANT_WORKSPACE_ROOTS', JSON.stringify([targetProject])),
      safeEnvironmentLine('ASSISTANT_KERNEL', 'off'),
      safeEnvironmentLine('ASSISTANT_RUNTIME', 'control-only'),
      safeEnvironmentLine('QUARK_APPLICATION_MODE', 'compatibility'),
      safeEnvironmentLine('TAKEOVER_CONFIRMED', 'false'),
      safeEnvironmentLine('WORK_JOURNAL_ENABLED', 'false'),
      safeEnvironmentLine('WEB_HOST', '127.0.0.1'),
      safeEnvironmentLine('WEB_PORT', String(port)),
      safeEnvironmentLine('CONSOLE_TOKEN', randomBytes(32).toString('base64url')),
      safeEnvironmentLine('CONTROL_PLANE_TOKEN', randomBytes(32).toString('base64url')),
      safeEnvironmentLine('DSH_HOME', join(targetVar, 'dsh')),
      '',
    ].join('\n')
    await writeFile(join(temporaryVar, 'restore-safe.env'), environment, { mode: 0o600 })

    restoreStarted = true
    await run(binaries.pgRestore, [
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges',
      `--dbname=${pgEnvironment.PGDATABASE}`, dumpPath,
    ], { env: pgEnvironment })
    const restoredMigrations = await postgresQuery(
      binaries.psql,
      'SELECT version FROM schema_migration ORDER BY version;',
      pgEnvironment,
    )
    if (JSON.stringify(restoredMigrations) !== JSON.stringify(metadata.migrations)) {
      throw new Error('PostgreSQL restored migration set does not match the snapshot')
    }
    const restoredRelations = await postgresQuery(
      binaries.psql,
      `SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND c.relkind IN ('r', 'p');`,
      pgEnvironment,
    )
    if (restoredRelations.length !== 1 || !/^\d+$/.test(restoredRelations[0]) || Number(restoredRelations[0]) < 1) {
      throw new Error('PostgreSQL restore verification found no application relations')
    }

    const receipt: RestoreSafeReceipt = {
      mode: 'restore-safe',
      bundleId: document.bundleId,
      gitRevision: document.gitRevision,
      preparedAt: new Date().toISOString(),
      runtimeEnvironment: 'var/restore-safe.env',
      pendingGates: [
        'account-reauthentication-or-reviewed-import',
        'workspace-path-review',
        'read-only-runtime-verification',
        'old-instance-stopped',
        'owner-approved-single-writer-takeover',
      ],
    }
    await writeFile(join(temporaryVar, 'restore-safe-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryVar, targetVar)
    return receipt
  } catch (error) {
    await rm(temporaryVar, { recursive: true, force: true })
    if (restoreStarted) {
      const reason = error instanceof Error ? error.message : 'unknown PostgreSQL restore failure'
      throw new Error(`${reason}; the isolated target database may now contain restored data and must be inspected or discarded`)
    }
    throw error
  }
}

export async function stageRecoveryBundle(options: StageBundleOptions): Promise<BundleDocument> {
  const input = resolve(options.input)
  const outputDirectory = resolve(options.outputDirectory)
  const identityFile = resolve(options.identityFile)
  const binaries = { ...defaultBinaries, ...options.binaries }
  await assertAgeFile(input)
  try {
    await lstat(outputDirectory)
    throw new Error('restore staging output already exists')
  } catch (error) {
    if (error instanceof Error && error.message === 'restore staging output already exists') throw error
  }
  await mkdir(dirname(outputDirectory), { recursive: true, mode: 0o700 })
  const temporaryRoot = await mkdtemp(join(dirname(outputDirectory), '.quark-restore-'))
  await chmod(temporaryRoot, 0o700)
  const archivePath = join(temporaryRoot, 'bundle.tar.gz')
  try {
    await run(binaries.age, ['-d', '-i', identityFile, '-o', archivePath, input])
    await validateArchiveEntries(archivePath, binaries.tar)
    await run(binaries.tar, ['-xzf', archivePath, '-C', temporaryRoot])
    const document = await verifyStagedBundle(join(temporaryRoot, 'bundle'), binaries.sqlite3)
    await rename(join(temporaryRoot, 'bundle'), outputDirectory)
    await chmod(outputDirectory, 0o700)
    return document
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true })
    throw error
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode === 'create') {
    const output = argument('--output') || process.env.QUARK_RECOVERY_BUNDLE_OUTPUT
    const recipient = argument('--recipient') || process.env.QUARK_RECOVERY_AGE_RECIPIENT
    if (!output || !recipient) throw new Error('create requires --output and --recipient (or recovery environment variables)')
    const runtimeEnvironment = await readRuntimeEnvironment(resolve(scriptRoot, 'var/runtime.env'))
    const document = await createRecoveryBundle({
      projectRoot: scriptRoot,
      home: homedir(),
      environment: { ...runtimeEnvironment, ...process.env },
      output,
      recipient,
      includeOptional: process.argv.includes('--include-optional'),
      quiesced: process.argv.includes('--quiesced'),
    })
    process.stdout.write(`${JSON.stringify({ ok: true, bundleId: document.bundleId, output, captureMode: document.captureMode })}\n`)
    return
  }
  if (mode === 'stage') {
    const input = argument('--input')
    const outputDirectory = argument('--output-directory')
    const identityFile = argument('--identity-file')
    if (!input || !outputDirectory || !identityFile) {
      throw new Error('stage requires --input, --output-directory, and --identity-file')
    }
    const document = await stageRecoveryBundle({ input, outputDirectory, identityFile })
    process.stdout.write(`${JSON.stringify({ ok: true, bundleId: document.bundleId, outputDirectory })}\n`)
    return
  }
  if (mode === 'prepare') {
    const stagingDirectory = argument('--staging-directory')
    const targetProjectRoot = argument('--project-root') || scriptRoot
    const webPortValue = argument('--web-port')
    if (!stagingDirectory) throw new Error('prepare requires --staging-directory')
    const receipt = await prepareRestoreSafe({
      stagingDirectory,
      projectRoot: targetProjectRoot,
      ...(webPortValue ? { webPort: Number(webPortValue) } : {}),
    })
    process.stdout.write(`${JSON.stringify({ ok: true, ...receipt })}\n`)
    return
  }
  if (mode === 'prepare-postgres') {
    const stagingDirectory = argument('--staging-directory')
    const targetProjectRoot = argument('--project-root') || scriptRoot
    const approvedBundleId = argument('--approved-bundle-id')
    const databaseUrl = process.env.QUARK_RESTORE_POSTGRES_URL
    const webPortValue = argument('--web-port')
    if (!stagingDirectory || !approvedBundleId || !databaseUrl) {
      throw new Error('prepare-postgres requires --staging-directory, --approved-bundle-id, and QUARK_RESTORE_POSTGRES_URL')
    }
    const receipt = await preparePostgresRestoreSafe({
      stagingDirectory,
      projectRoot: targetProjectRoot,
      databaseUrl,
      approvedBundleId,
      environment: process.env,
      ...(webPortValue ? { webPort: Number(webPortValue) } : {}),
    })
    process.stdout.write(`${JSON.stringify({ ok: true, ...receipt })}\n`)
    return
  }
  throw new Error('usage: recovery-bundle.ts create|stage|prepare|prepare-postgres [options]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
