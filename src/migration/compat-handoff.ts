import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { auditLegacyState } from './legacy-state-audit.js'
import { inspectCompatibilityConfig } from './compat-preflight.js'

export interface CompatibilityHandoffOptions {
  readonly legacyConfigPath: string
  readonly legacyStatePath: string
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
  readonly stateSha256: string
  readonly reused: boolean
  readonly handoffSafe: true
  readonly sourceReadOnly: true
  readonly overwroteExistingFile: false
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

export async function prepareCompatibilityHandoff(options: CompatibilityHandoffOptions): Promise<CompatibilityHandoffResult> {
  const destinationRoot = resolve(options.destinationRoot)
  if (destinationRoot === '/') throw new Error('handoff destination cannot be the filesystem root')
  const [legacyConfigBytes, stateBytes] = await Promise.all([
    readFile(resolve(options.legacyConfigPath)),
    readFile(resolve(options.legacyStatePath)),
  ])
  const state = JSON.parse(stateBytes.toString('utf8')) as Record<string, unknown>
  const audit = auditLegacyState(state)
  if (!audit.handoffSafe) throw new Error(`legacy state is not handoff-safe: ${audit.blockers.map((item) => item.code).join(', ')}`)
  const legacyConfig = JSON.parse(legacyConfigBytes.toString('utf8')) as Record<string, unknown>
  const identity = createHash('sha256')
    .update(stateBytes)
    .update('\0')
    .update(legacyConfigBytes)
    .update('\0')
    .update(JSON.stringify({ executables: options.executables, didaCliConfigPath: options.didaCliConfigPath }))
    .digest('hex')
  const directory = join(destinationRoot, identity.slice(0, 20))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const statePath = join(directory, 'state.json')
  const configPath = join(directory, 'config.json')
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
  const report = await inspectCompatibilityConfig(configPath, {
    home: options.home,
    ...(options.path === undefined ? {} : { path: options.path }),
  })
  if (!report.ready) throw new Error(`prepared compatibility handoff failed preflight: ${report.blockers.join(', ')}`)
  return {
    directory,
    configPath,
    statePath,
    stateSha256: createHash('sha256').update(stateBytes).digest('hex'),
    reused: stateReused && configReused,
    handoffSafe: true,
    sourceReadOnly: true,
    overwroteExistingFile: false,
  }
}

export function handoffLabel(result: CompatibilityHandoffResult): string {
  return basename(result.directory)
}
