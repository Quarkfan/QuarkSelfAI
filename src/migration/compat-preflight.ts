import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { auditLegacyState } from './legacy-state-audit.js'

const REQUIRED_CONFIG = ['allowedOpenId', 'codexHome', 'workspaceRoot', 'didaProjectId', 'followupProjectId'] as const

export interface CompatibilityPreflightReport {
  readonly ready: boolean
  readonly explicitVarDir: boolean
  readonly stateReadable: boolean
  readonly handoffSafe: boolean
  readonly didaCredentialReady: boolean
  readonly executables: Readonly<Record<string, { readonly ready: boolean; readonly path?: string }>>
  readonly missingConfigKeys: readonly string[]
  readonly blockers: readonly string[]
}

async function executable(command: string, pathValue: string | undefined): Promise<string | undefined> {
  const candidates = command.includes('/')
    ? [resolve(command)]
    : (pathValue ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, command))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  return undefined
}

async function didaCredential(filename: string): Promise<boolean> {
  try {
    const [contents, metadata] = await Promise.all([readFile(filename, 'utf8'), stat(filename)])
    if ((metadata.mode & 0o077) !== 0) return false
    const document = JSON.parse(contents) as { access_token?: unknown }
    return typeof document.access_token === 'string' && document.access_token.length > 0
  } catch {
    return false
  }
}

export async function inspectCompatibilityConfig(
  configPath: string,
  options: { readonly path?: string; readonly home: string },
): Promise<CompatibilityPreflightReport> {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
  const missingConfigKeys = REQUIRED_CONFIG.filter((key) => typeof config[key] !== 'string' || !(config[key] as string).trim())
  const explicitVarDir = typeof config.varDir === 'string' && isAbsolute(config.varDir) && config.varDir.length > 0
  const commands = {
    lark: typeof config.larkCli === 'string' && config.larkCli ? config.larkCli : 'lark-cli',
    dida: typeof config.didaCli === 'string' && config.didaCli ? config.didaCli : 'dida',
    claude: typeof config.claudeCli === 'string' && config.claudeCli ? config.claudeCli : 'claude',
    codex: typeof config.codexCli === 'string' && config.codexCli ? config.codexCli : 'codex',
  }
  const executableEntries = await Promise.all(Object.entries(commands).map(async ([name, command]) => {
    const path = await executable(command, options.path)
    return [name, { ready: path !== undefined, ...(path ? { path } : {}) }] as const
  }))
  const executables = Object.fromEntries(executableEntries)
  let stateReadable = false
  let handoffSafe = false
  if (explicitVarDir) {
    try {
      const state = JSON.parse(await readFile(join(config.varDir as string, 'state.json'), 'utf8')) as Record<string, unknown>
      stateReadable = true
      handoffSafe = auditLegacyState(state).handoffSafe
    } catch {}
  }
  const didaPath = typeof config.didaCliConfigPath === 'string' && isAbsolute(config.didaCliConfigPath)
    ? config.didaCliConfigPath
    : join(options.home, '.config', 'dida-cli', 'config.json')
  const didaCredentialReady = await didaCredential(didaPath)
  const blockers: string[] = []
  if (missingConfigKeys.length) blockers.push('missing-required-config')
  if (!explicitVarDir) blockers.push('var-dir-not-explicit')
  else if (!stateReadable) blockers.push('state-not-readable')
  else if (!handoffSafe) blockers.push('state-not-handoff-safe')
  for (const [name, value] of Object.entries(executables)) if (!value.ready) blockers.push(`${name}-executable-not-found`)
  if (!didaCredentialReady) blockers.push('dida-credential-not-ready')
  return {
    ready: blockers.length === 0,
    explicitVarDir,
    stateReadable,
    handoffSafe,
    didaCredentialReady,
    executables,
    missingConfigKeys,
    blockers,
  }
}
