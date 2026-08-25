import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { auditLegacyState } from './legacy-state-audit.js'
import { inspectCompatibilityConfig } from './compat-preflight.js'

export interface CompatibilityHandoffOptions {
  readonly legacyConfigPath: string
  readonly legacyStatePath: string
  readonly legacyDidaDirectory: string
  readonly destinationRoot: string
  readonly home: string
  readonly path?: string
  readonly executables: {
    readonly larkCli: string
    readonly didaCli: string
    readonly claudeCli: string
    readonly codexCli: string
  }
  readonly didaCliConfigPath: string
}

export interface CompatibilityHandoffResult {
  readonly directory: string
  readonly configPath: string
  readonly statePath: string
  readonly didaPath: string
  readonly evidenceManifestPath: string
  readonly stateSha256: string
  readonly didaSha256: string
  readonly didaFiles: number
  readonly reused: boolean
  readonly handoffSafe: true
  readonly sourceReadOnly: true
  readonly overwroteExistingFile: false
}

interface EvidenceFile {
  readonly relativePath: string
  readonly contents: Buffer
  readonly sha256: string
  readonly modifiedAt: string
}

async function createOrVerify(filename: string, contents: Buffer | string): Promise<boolean> {
  try {
    await writeFile(filename, contents, { flag: 'wx', mode: 0o600 })
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
    const existing = await readFile(filename)
    if (!existing.equals(expected)) throw new Error(`handoff artifact ${filename} already exists with different content`)
    return true
  }
}

async function collectEvidenceFiles(root: string, directory = root): Promise<EvidenceFile[]> {
  const files: EvidenceFile[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectEvidenceFiles(root, filename))
    else if (entry.isFile()) {
      const [contents, metadata] = await Promise.all([readFile(filename), stat(filename)])
      files.push({
        relativePath: relative(root, filename),
        contents,
        sha256: createHash('sha256').update(contents).digest('hex'),
        modifiedAt: metadata.mtime.toISOString(),
      })
    } else {
      throw new Error(`handoff evidence contains unsupported filesystem entry: ${filename}`)
    }
  }
  return files
}

function evidenceDigest(files: readonly EvidenceFile[]): string {
  const digest = createHash('sha256')
  for (const file of files) digest
    .update(file.relativePath).update('\0')
    .update(file.sha256).update('\0')
    .update(file.modifiedAt).update('\0')
  return digest.digest('hex')
}

export async function prepareCompatibilityHandoff(options: CompatibilityHandoffOptions): Promise<CompatibilityHandoffResult> {
  const destinationRoot = resolve(options.destinationRoot)
  if (destinationRoot === '/') throw new Error('handoff destination cannot be the filesystem root')
  const [legacyConfigBytes, stateBytes, didaFiles] = await Promise.all([
    readFile(resolve(options.legacyConfigPath)),
    readFile(resolve(options.legacyStatePath)),
    collectEvidenceFiles(resolve(options.legacyDidaDirectory)),
  ])
  if (!didaFiles.some(file => basename(file.relativePath) === 'result.json')) {
    throw new Error('handoff Dida evidence must contain at least one result.json')
  }
  const didaSha256 = evidenceDigest(didaFiles)
  const state = JSON.parse(stateBytes.toString('utf8')) as Record<string, unknown>
  const audit = auditLegacyState(state)
  if (!audit.handoffSafe) throw new Error(`legacy state is not handoff-safe: ${audit.blockers.map((item) => item.code).join(', ')}`)
  const legacyConfig = JSON.parse(legacyConfigBytes.toString('utf8')) as Record<string, unknown>
  const identity = createHash('sha256')
    .update(stateBytes)
    .update('\0')
    .update(legacyConfigBytes)
    .update('\0')
    .update(didaSha256)
    .update('\0')
    .update(JSON.stringify({ executables: options.executables, didaCliConfigPath: options.didaCliConfigPath }))
    .digest('hex')
  const directory = join(destinationRoot, identity.slice(0, 20))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const statePath = join(directory, 'state.json')
  const configPath = join(directory, 'config.json')
  const didaPath = join(directory, 'dida')
  const evidenceManifestPath = join(directory, 'evidence-manifest.json')
  const preparedConfig = JSON.stringify({
    ...legacyConfig,
    ...options.executables,
    didaCliConfigPath: resolve(options.didaCliConfigPath),
    varDir: directory,
  }, null, 2) + '\n'
  const [stateReused, configReused] = await Promise.all([
    createOrVerify(statePath, stateBytes),
    createOrVerify(configPath, preparedConfig),
  ])
  const evidenceReuse: boolean[] = []
  for (const file of didaFiles) {
    const target = join(didaPath, file.relativePath)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    evidenceReuse.push(await createOrVerify(target, file.contents))
    const modifiedAt = new Date(file.modifiedAt)
    await utimes(target, modifiedAt, modifiedAt)
  }
  const evidenceManifest = `${JSON.stringify({
    version: 1,
    state: { path: 'state.json', bytes: stateBytes.length, sha256: createHash('sha256').update(stateBytes).digest('hex') },
    dida: {
      path: 'dida',
      sha256: didaSha256,
      files: didaFiles.map(file => ({
        path: file.relativePath, bytes: file.contents.length, sha256: file.sha256, modifiedAt: file.modifiedAt,
      })),
    },
  }, null, 2)}\n`
  const manifestReused = await createOrVerify(evidenceManifestPath, evidenceManifest)
  const report = await inspectCompatibilityConfig(configPath, {
    home: options.home,
    ...(options.path === undefined ? {} : { path: options.path }),
  })
  if (!report.ready) throw new Error(`prepared compatibility handoff failed preflight: ${report.blockers.join(', ')}`)
  return {
    directory,
    configPath,
    statePath,
    didaPath,
    evidenceManifestPath,
    stateSha256: createHash('sha256').update(stateBytes).digest('hex'),
    didaSha256,
    didaFiles: didaFiles.length,
    reused: stateReused && configReused && manifestReused && evidenceReuse.every(Boolean),
    handoffSafe: true,
    sourceReadOnly: true,
    overwroteExistingFile: false,
  }
}

export function handoffLabel(result: CompatibilityHandoffResult): string {
  return basename(result.directory)
}
