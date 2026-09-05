import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  preparePostgresRestoreSafe,
  prepareRestoreSafe,
  stageRecoveryBundle,
  type PreparePostgresRestoreSafeOptions,
  type PrepareRestoreSafeOptions,
  type RestoreSafeReceipt,
  type StageBundleOptions,
} from './recovery-bundle.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type StagedBundle = {
  bundleId: string
  storage: string
}

export type RecoveryCloneBootstrapOptions = {
  input: string
  identityFile: string
  projectRoot: string
  webPort?: number
  approvedBundleId?: string
  postgresUrl?: string
  environment?: NodeJS.ProcessEnv
}

export type RecoveryCloneBootstrapDependencies = {
  createTemporaryRoot: () => Promise<string>
  removeTemporaryRoot: (path: string) => Promise<void>
  stage: (options: StageBundleOptions) => Promise<StagedBundle>
  prepareSqlite: (options: PrepareRestoreSafeOptions) => Promise<RestoreSafeReceipt>
  preparePostgres: (options: PreparePostgresRestoreSafeOptions) => Promise<RestoreSafeReceipt>
}

const dependencies: RecoveryCloneBootstrapDependencies = {
  createTemporaryRoot: async () => {
    const path = await mkdtemp(join(tmpdir(), 'quark-recovery-bootstrap-'))
    await chmod(path, 0o700)
    return path
  },
  removeTemporaryRoot: async path => await rm(path, { recursive: true, force: true }),
  stage: stageRecoveryBundle,
  prepareSqlite: prepareRestoreSafe,
  preparePostgres: preparePostgresRestoreSafe,
}

function nonempty(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value
}

export async function prepareRecoveryClone(
  options: RecoveryCloneBootstrapOptions,
  injected: RecoveryCloneBootstrapDependencies = dependencies,
): Promise<RestoreSafeReceipt> {
  const input = resolve(nonempty(options.input, 'recovery bundle input'))
  const identityFile = resolve(nonempty(options.identityFile, 'age identity file'))
  const targetRoot = resolve(nonempty(options.projectRoot, 'project root'))
  if (options.webPort !== undefined && (!Number.isSafeInteger(options.webPort) || options.webPort < 1 || options.webPort > 65_535)) {
    throw new Error('restore-safe web port is invalid')
  }

  const temporaryRoot = await injected.createTemporaryRoot()
  const stagingDirectory = join(temporaryRoot, 'staged')
  try {
    const document = await injected.stage({ input, identityFile, outputDirectory: stagingDirectory })
    if (document.storage === 'sqlite') {
      return await injected.prepareSqlite({
        stagingDirectory,
        projectRoot: targetRoot,
        ...(options.webPort === undefined ? {} : { webPort: options.webPort }),
      })
    }
    if (document.storage === 'postgres') {
      const approvedBundleId = nonempty(options.approvedBundleId, 'approved PostgreSQL bundle id')
      if (approvedBundleId !== document.bundleId) throw new Error('approved PostgreSQL bundle id does not match the staged bundle')
      const databaseUrl = nonempty(options.postgresUrl, 'PostgreSQL restore URL')
      return await injected.preparePostgres({
        stagingDirectory,
        projectRoot: targetRoot,
        databaseUrl,
        approvedBundleId,
        environment: options.environment ?? process.env,
        ...(options.webPort === undefined ? {} : { webPort: options.webPort }),
      })
    }
    throw new Error('recovery bundle storage mode is unsupported')
  } finally {
    await injected.removeTemporaryRoot(temporaryRoot)
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main(): Promise<void> {
  const input = argument('--input')
  const identityFile = argument('--identity-file')
  if (!input || !identityFile) throw new Error('bootstrap requires --input and --identity-file')
  const webPortValue = argument('--web-port')
  const receipt = await prepareRecoveryClone({
    input,
    identityFile,
    projectRoot: argument('--project-root') || projectRoot,
    approvedBundleId: argument('--approved-bundle-id'),
    postgresUrl: process.env.QUARK_RESTORE_POSTGRES_URL,
    environment: process.env,
    ...(webPortValue ? { webPort: Number(webPortValue) } : {}),
  })
  process.stdout.write(`${JSON.stringify({ ok: true, ...receipt })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
