import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type RecoveryContext = {
  projectRoot: string
  home: string
  environment: Record<string, string | undefined>
}

type RequiredWhen = 'always' | 'sqlite' | 'postgres' | 'compatibility' | 'optional'

type RecoveryManifest = {
  schemaVersion: number
  projectId: string
  repository: {
    origin: string
    requiredTrackedPaths: string[]
  }
  runtime: {
    requiredCommands: string[]
    recoveryCommands: Array<{
      command: string
      requiredWhen: Exclude<RequiredWhen, 'compatibility' | 'optional'>
    }>
  }
  requiredResources: Array<{
    id: string
    environment: string
    fallbackConfig?: {
      path: string
      property: string
    }
    secret: boolean
    description: string
  }>
  artifacts: Array<{
    id: string
    class: string
    selector: string
    selectorKind?: 'path' | 'environment'
    requiredWhen: RequiredWhen
    backupMethod: string
    sensitivity: string
    restoreOrder: number
  }>
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function expandSelector(selector: string, context: RecoveryContext): string | undefined {
  const envOnly = selector.match(/^\$\{ENV:([A-Z0-9_]+)\}$/)
  if (envOnly) return context.environment[envOnly[1]] || undefined
  const expanded = selector
    .replaceAll('${PROJECT_ROOT}', context.projectRoot)
    .replaceAll('${HOME}', context.home)
  return expanded.includes('${') ? undefined : resolve(expanded)
}

export function isRequired(
  requiredWhen: RequiredWhen,
  runtime: { storage: string; mode: string },
): boolean {
  if (requiredWhen === 'always') return true
  if (requiredWhen === 'sqlite') return runtime.storage === 'sqlite'
  if (requiredWhen === 'postgres') return runtime.storage === 'postgres'
  if (requiredWhen === 'compatibility') return runtime.mode === 'compatibility' || runtime.mode === 'compat'
  return false
}

export function normalizeGitRemote(value: string): string {
  return value
    .trim()
    .replace(/^git\+ssh:\/\/git@/, 'git@')
    .replace(/^https:\/\/github\.com\//, 'github.com:')
    .replace(/^git@github\.com:/, 'github.com:')
    .replace(/\.git$/, '')
}

export async function readRuntimeEnvironment(path: string): Promise<Record<string, string>> {
  const allowed = new Set([
    'ASSISTANT_STORAGE',
    'ASSISTANT_RUNTIME',
    'QUARK_APPLICATION_MODE',
    'COMPAT_CONFIG_PATH',
    'DATABASE_URL',
  ])
  const result: Record<string, string> = {}
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return result
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const separator = line.indexOf('=')
    const key = line.slice(0, separator)
    if (allowed.has(key)) result[key] = line.slice(separator + 1)
  }
  return result
}

async function readConfiguredProperty(
  root: string,
  fallback: { path: string; property: string } | undefined,
): Promise<boolean> {
  if (!fallback) return false
  const path = resolve(root, fallback.path)
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const configuredValue = fallback.property.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
      return (current as Record<string, unknown>)[segment]
    }, value)
    if (typeof configuredValue !== 'string') return false
    const configured = configuredValue.trim()
    return Boolean(configured) && !configured.startsWith('PENDING_')
  } catch {
    return false
  }
}

async function pathKind(path: string): Promise<'file' | 'directory' | 'missing'> {
  try {
    const entry = await stat(path)
    return entry.isDirectory() ? 'directory' : 'file'
  } catch {
    return 'missing'
  }
}

function trackedPaths(root: string): Set<string> {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  return new Set(output.split(/\r?\n/).filter(Boolean))
}

function origin(root: string): string | undefined {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

function commandAvailable(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function auditRecoveryReadiness(root = projectRoot) {
  const manifestPath = resolve(root, 'config/recovery-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RecoveryManifest
  if (manifest.schemaVersion !== 1) throw new Error(`unsupported recovery manifest schema ${manifest.schemaVersion}`)

  const runtimeFile = resolve(root, 'var/runtime.env')
  const runtimeEnvironment = await readRuntimeEnvironment(runtimeFile)
  const environment = { ...runtimeEnvironment, ...process.env }
  const runtime = {
    storage: environment.ASSISTANT_STORAGE || 'sqlite',
    mode: environment.QUARK_APPLICATION_MODE || environment.ASSISTANT_RUNTIME || 'compatibility',
  }
  const context: RecoveryContext = { projectRoot: root, home: homedir(), environment }
  const tracked = trackedPaths(root)
  const actualOrigin = origin(root)

  const missingTracked = manifest.repository.requiredTrackedPaths.filter(path => !tracked.has(path))
  const source = {
    expectedOrigin: normalizeGitRemote(manifest.repository.origin),
    actualOrigin: actualOrigin ? normalizeGitRemote(actualOrigin) : null,
    originMatches: Boolean(actualOrigin)
      && normalizeGitRemote(actualOrigin as string) === normalizeGitRemote(manifest.repository.origin),
    missingTracked,
  }
  const commands = manifest.runtime.requiredCommands.map(command => ({
    command,
    available: commandAvailable(command),
  }))
  const recoveryCommands = manifest.runtime.recoveryCommands.map(item => ({
    command: item.command,
    required: isRequired(item.requiredWhen, runtime),
    available: commandAvailable(item.command),
  }))

  const artifacts = []
  for (const artifact of manifest.artifacts) {
    const required = isRequired(artifact.requiredWhen, runtime)
    const path = expandSelector(artifact.selector, context)
    const kind = artifact.selectorKind === 'environment'
      ? (path ? 'configuration' : 'missing')
      : (path ? await pathKind(path) : 'missing')
    artifacts.push({
      id: artifact.id,
      class: artifact.class,
      required,
      present: kind !== 'missing',
      kind,
      backupMethod: artifact.backupMethod,
      sensitivity: artifact.sensitivity,
    })
  }

  const resources = await Promise.all(manifest.requiredResources.map(async resource => ({
    id: resource.id,
    configured: Boolean(process.env[resource.environment])
      || await readConfiguredProperty(root, resource.fallbackConfig),
    environment: resource.environment,
    secret: resource.secret,
    description: resource.description,
  })))
  const blockers = [
    ...(!source.originMatches ? ['repository-origin-mismatch'] : []),
    ...missingTracked.map(path => `untracked-required-source:${path}`),
    ...commands.filter(item => !item.available).map(item => `missing-runtime-command:${item.command}`),
    ...recoveryCommands
      .filter(item => item.required && !item.available)
      .map(item => `missing-recovery-command:${item.command}`),
    ...artifacts.filter(item => item.required && !item.present).map(item => `missing-required-artifact:${item.id}`),
    ...resources.filter(item => !item.configured).map(item => `missing-resource:${item.id}`),
  ]

  return {
    ok: blockers.length === 0,
    projectId: manifest.projectId,
    runtime,
    source,
    commands,
    recoveryCommands,
    artifacts,
    resources,
    blockers,
    note: 'This audit checks inventory and prerequisites only; it never reads credential values. A staged restore with checksum and database integrity verification is still required to prove a backup is restorable.',
  }
}

async function main() {
  const report = await auditRecoveryReadiness()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
