import { isAbsolute, resolve } from 'node:path'
import type { AssistantIdentity } from '../domain/contracts.js'
import type { StorageKind } from '../storage/types.js'

export interface RuntimeConfig {
  readonly execution:
    | { readonly mode: 'local'; readonly workspaceRoots: readonly string[] }
    | { readonly mode: 'remote'; readonly workspaceRoots: readonly [] }
  readonly storage:
    | { readonly kind: 'sqlite'; readonly path: string }
    | { readonly kind: 'postgres'; readonly databaseUrl: string }
  readonly web: {
    readonly host: string
    readonly port: number
    readonly consoleToken?: string
    readonly secureCookie: boolean
  }
  readonly controlPlane: {
    readonly token?: string
  }
  readonly lark: {
    readonly executable: string
    readonly identity: AssistantIdentity
  }
  readonly runtime:
    | { readonly mode: 'control-only' }
    | { readonly mode: 'compat'; readonly configPath: string }
}

function storageKind(value: string | undefined): StorageKind {
  if (!value || value === 'sqlite') return 'sqlite'
  if (value === 'postgres' || value === 'pg') return 'postgres'
  throw new Error(`ASSISTANT_STORAGE must be sqlite or postgres, received ${value}`)
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? '3210')
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`WEB_PORT must be an integer from 1 to 65535, received ${String(value)}`)
  }
  return parsed
}

function boolean(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function workspaceRoots(value: string | undefined, cwd: string): readonly string[] {
  if (!value?.trim()) return [resolve(cwd)]
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('ASSISTANT_WORKSPACE_ROOTS must be a JSON array of absolute paths')
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== 'string' || !item.trim() || !isAbsolute(item))) {
    throw new Error('ASSISTANT_WORKSPACE_ROOTS must be a non-empty JSON array of absolute paths')
  }
  return [...new Set(parsed.map((item) => resolve(item as string)))]
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): RuntimeConfig {
  const kind = storageKind(env.ASSISTANT_STORAGE)
  const host = env.WEB_HOST ?? '127.0.0.1'
  const consoleToken = env.CONSOLE_TOKEN?.trim() || undefined
  if (!isLoopback(host) && !consoleToken) {
    throw new Error('CONSOLE_TOKEN is required when WEB_HOST is not loopback')
  }
  const storage = kind === 'postgres'
    ? { kind, databaseUrl: env.DATABASE_URL?.trim() || '' }
    : { kind, path: resolve(cwd, env.SQLITE_PATH ?? 'var/quarkselfai.sqlite3') }
  if (storage.kind === 'postgres' && !storage.databaseUrl) {
    throw new Error('DATABASE_URL is required when ASSISTANT_STORAGE=postgres')
  }
  if (env.LARK_IDENTITY && env.LARK_IDENTITY !== 'user' && env.LARK_IDENTITY !== 'bot') {
    throw new Error(`LARK_IDENTITY must be user or bot, received ${env.LARK_IDENTITY}`)
  }
  const identity = env.LARK_IDENTITY === 'user' ? 'user' : 'bot'
  const runtimeMode = env.ASSISTANT_RUNTIME ?? 'control-only'
  if (runtimeMode !== 'control-only' && runtimeMode !== 'compat') {
    throw new Error(`ASSISTANT_RUNTIME must be control-only or compat, received ${runtimeMode}`)
  }
  const compatConfigPath = env.COMPAT_CONFIG_PATH?.trim()
  const controlPlaneToken = env.CONTROL_PLANE_TOKEN?.trim() || undefined
  if (runtimeMode === 'compat' && !compatConfigPath) {
    throw new Error('COMPAT_CONFIG_PATH is required when ASSISTANT_RUNTIME=compat')
  }
  if (runtimeMode === 'compat' && env.TAKEOVER_CONFIRMED !== 'true') {
    throw new Error('TAKEOVER_CONFIRMED=true is required to start the production compatibility runtime')
  }
  if (runtimeMode === 'compat' && !controlPlaneToken) {
    throw new Error('CONTROL_PLANE_TOKEN is required when ASSISTANT_RUNTIME=compat')
  }
  const executionMode = env.ASSISTANT_EXECUTION_MODE ?? 'local'
  if (executionMode !== 'local' && executionMode !== 'remote') {
    throw new Error(`ASSISTANT_EXECUTION_MODE must be local or remote, received ${executionMode}`)
  }
  if (executionMode === 'remote' && runtimeMode === 'compat') {
    throw new Error('ASSISTANT_RUNTIME=compat requires ASSISTANT_EXECUTION_MODE=local')
  }
  return {
    execution: executionMode === 'local'
      ? { mode: 'local', workspaceRoots: workspaceRoots(env.ASSISTANT_WORKSPACE_ROOTS, cwd) }
      : { mode: 'remote', workspaceRoots: [] },
    storage,
    web: {
      host,
      port: port(env.WEB_PORT),
      ...(consoleToken ? { consoleToken } : {}),
      secureCookie: boolean(env.CONSOLE_SECURE_COOKIE),
    },
    controlPlane: {
      ...(controlPlaneToken ? { token: controlPlaneToken } : {}),
    },
    lark: {
      executable: env.LARK_CLI_EXECUTABLE ?? 'lark-cli',
      identity,
    },
    runtime: runtimeMode === 'compat'
      ? { mode: runtimeMode, configPath: resolve(cwd, compatConfigPath ?? '') }
      : { mode: 'control-only' },
  }
}
