import { resolve } from 'node:path'
import type { AssistantIdentity } from '../domain/contracts.js'
import type { StorageKind } from '../storage/types.js'

export interface RuntimeConfig {
  readonly storage:
    | { readonly kind: 'sqlite'; readonly path: string }
    | { readonly kind: 'postgres'; readonly databaseUrl: string }
  readonly web: {
    readonly host: string
    readonly port: number
    readonly consoleToken?: string
    readonly secureCookie: boolean
  }
  readonly lark: {
    readonly executable: string
    readonly identity: AssistantIdentity
  }
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
  return {
    storage,
    web: {
      host,
      port: port(env.WEB_PORT),
      ...(consoleToken ? { consoleToken } : {}),
      secureCookie: boolean(env.CONSOLE_SECURE_COOKIE),
    },
    lark: {
      executable: env.LARK_CLI_EXECUTABLE ?? 'lark-cli',
      identity,
    },
  }
}
